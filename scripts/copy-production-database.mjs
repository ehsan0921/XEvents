import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, validateSeparation, buildConfig } from './deployment-config.mjs';
import { temporaryConfig, wrangler, jsonOutput } from './deployment-tools.mjs';
import { prepareSnapshot } from './database-snapshot.mjs';

const safeError = message => Object.assign(new Error(message), { safe: true });
function rows(output) {
  const result = jsonOutput(output);
  if (!Array.isArray(result) || !result.length || result.some(statement => statement.success !== true || !Array.isArray(statement.results))) throw safeError('The database response could not be verified. Development was not changed.');
  return result.flatMap(statement => statement.results);
}

export async function copyProductionDatabase({ env = process.env, run = wrangler, fetcher = fetch, migrationsDirectory = '.wrangler/development-code/migrations' } = {}) {
  if (env.GITHUB_REF_NAME !== 'main') throw safeError('Run the database refresh workflow from main.');
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) throw safeError('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the development-refresh GitHub environment.');
  const dev = parseConfig(env.WRANGLER_CONFIG_JSON), prod = parseConfig(env.PRODUCTION_CONFIG_JSON);
  validateSeparation(dev, prod);
  const health = await fetcher(new URL('/', dev.vars.APP_URL), { signal: AbortSignal.timeout(15000) });
  const status = health.ok && await health.json();
  if (status?.status !== 'running' || status.databaseRefreshProtection !== 1) throw safeError('Deploy the development database-refresh protection before copying production data. Development was not changed.');

  const root = await realpath('.');
  const migrationPath = await realpath(migrationsDirectory);
  if (!migrationPath.startsWith(root + sep)) throw safeError('Development migrations must come from the checked-out development source.');
  const names = (await readdir(migrationPath, { withFileTypes: true })).filter(entry => entry.isFile() && /^\d+_[A-Za-z0-9_-]+\.sql$/.test(entry.name)).map(entry => entry.name).sort();
  if (!names.length) throw safeError('The development migration set is missing. Development was not changed.');
  const migrations = await Promise.all(names.map(async name => ({ name, sql: await readFile(resolve(migrationPath, name), 'utf8') })));

  await mkdir(resolve('.wrangler'), { recursive: true });
  const directory = await mkdtemp(resolve('.wrangler/database-copy-'));
  let production, development;
  try {
    production = await temporaryConfig(await buildConfig(prod, 'production'), 'database-copy-production');
    development = await temporaryConfig(await buildConfig(dev, 'development'), 'database-copy-development');
    const query = command => run(['d1', 'execute', 'DB', '--remote', '--config', development.path, '--json', '--command', command]).then(rows);
    const schemaQuery = "SELECT type,name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type,name";
    const exported = resolve(directory, 'production.sql');
    await run(['d1', 'export', 'DB', '--remote', '--config', production.path, '--output', exported, '--skip-confirmation']);
    const developmentSchema = await query(schemaQuery);
    const settingsQuery = 'SELECT key,value FROM app_settings ORDER BY key';
    const developmentSettings = developmentSchema.some(table => table.name === 'app_settings') ? await query(settingsQuery) : [];
    const copiedAt = new Date().toISOString();
    const snapshot = prepareSnapshot({ sourceSql: await readFile(exported, 'utf8'), developmentSchema, developmentSettings, migrations, copiedAt });
    const prepared = resolve(directory, 'development.sql');
    await writeFile(prepared, snapshot.sql, { mode: 0o600 });
    const latestSchema = await query(schemaQuery);
    const latestSettings = latestSchema.some(table => table.name === 'app_settings') ? await query(settingsQuery) : [];
    if (JSON.stringify(latestSchema) !== JSON.stringify(developmentSchema) || JSON.stringify(latestSettings) !== JSON.stringify(developmentSettings)) throw safeError('Development schema or settings changed while preparing the snapshot. Run the refresh again; development was not changed.');
    // The only remote write targets the verified development binding. D1 imports
    // the replacement as one file; failed imports roll back instead of leaving
    // a separate reset operation committed ahead of the copied data.
    await run(['d1', 'execute', 'DB', '--remote', '--config', development.path, '--file', prepared, '--yes']);
    console.log('Production database snapshot copied to development. Development settings retained; delivery state cleared. Code branches and production data were not changed.');
    return snapshot.counts;
  } finally {
    try {
      await Promise.all([production?.cleanup(), development?.cleanup()]);
    } finally {
      // mkdtemp creates this exact workspace-owned directory; never delete a
      // caller-provided location when disposing of private database exports.
      if (!directory.startsWith(root + sep) || !directory.startsWith(resolve('.wrangler/database-copy-'))) throw safeError('Private export cleanup path could not be verified.');
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try { await copyProductionDatabase(); }
  catch (error) { console.error(error.safe ? error.message : 'Database refresh failed. Check the private environment configuration, Cloudflare permissions, migration compatibility and network connection. No database contents were logged.'); process.exitCode = 1; }
}
