import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function temporaryConfig(config, name) {
  const directory = resolve('.wrangler/ci');
  await mkdir(directory, { recursive: true });
  // Keep the generated config at the project root so relative asset/import paths stay correct.
  const path = resolve('wrangler.' + name + '.jsonc');
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { path, cleanup: () => rm(path, { force: true }) };
}

export function wrangler(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '', oversized = false;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      if (output.length + chunk.length > 8 * 1024 * 1024) { oversized = true; child.kill(); }
      else output += chunk.toString();
    });
    child.on('error', () => reject(new Error('Cloudflare CLI could not start.')));
    child.on('close', code => {
      // Wrangler output includes private URLs/IDs and sometimes exported SQL: do not print it.
      if (code !== 0 || oversized) reject(new Error('Cloudflare operation failed. Check the environment credentials, permissions and target configuration.'));
      else resolvePromise(output);
    });
  });
}

export function jsonOutput(output) {
  try { return JSON.parse(output); }
  catch { throw new Error('Cloudflare returned an unexpected response; no private output was logged.'); }
}

export function requireCredentials() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Set the environment Cloudflare API token and account ID secrets first.');
}
