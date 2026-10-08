import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { copyProductionDatabase } from '../scripts/copy-production-database.mjs';

const production = () => ({ name: 'fictional-production', vars: { BOT_USERNAME: 'FictionalProductionBot', APP_URL: 'https://production.test/app' }, d1_databases: [{ binding: 'DB', database_name: 'fictional-production-db', database_id: '11111111-1111-4111-8111-111111111111' }] });
const development = () => ({ name: 'fictional-development', vars: { BOT_USERNAME: 'FictionalDevelopmentBot', APP_URL: 'https://development.test/app', TEST_WHITELIST_ENABLED: 'true' }, d1_databases: [{ binding: 'DB', database_name: 'fictional-development-db', database_id: '22222222-2222-4222-8222-222222222222' }] });
const encoded = records => JSON.stringify([{ success: true, results: records }]);
const argument = (args, flag) => args[args.indexOf(flag) + 1];
const copyFiles = names => names.filter(name => /^wrangler\.database-copy-.*\.jsonc$/.test(name)).sort();
const copyDirectories = names => names.filter(name => name.startsWith('database-copy-')).sort();

async function fixture(t, { failAt, settingsRace = false, schemaRace = false, unhealthy } = {}) {
  await mkdir(resolve('.wrangler'), { recursive: true });
  const directory = await mkdtemp(resolve('.wrangler/test-database-copy-'));
  const migrationsDirectory = resolve(directory, 'migrations');
  await mkdir(migrationsDirectory);
  t.after(async () => {
    assert.ok(directory.startsWith(resolve('.wrangler') + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const names = ['0001_initial.sql', '0002_delivery_lease.sql', '0003_mini_app.sql'];
  const migrations = await Promise.all(names.map(async name => {
    const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
    await writeFile(resolve(migrationsDirectory, name), sql);
    return { name, sql };
  }));
  const sourceSql = migrations.map(migration => migration.sql).join('\n') + '\n' +
    'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);\n' +
    names.map(name => `INSERT INTO d1_migrations(name) VALUES('${name}');`).join('\n') + '\n' +
    "INSERT INTO records VALUES('events','fixture-event','{\"title\":\"Fictional fixture event\"}');\n" +
    "INSERT INTO app_settings VALUES('mini-menu','App:https://production.test/app');";
  const settings = [{ key: 'test-whitelist', value: '["900000001"]' }, { key: 'mini-menu', value: 'App:https://development.test/app' }];
  const schema = ['records', 'outbox', 'processed', 'lease', 'commits', 'delivery_lease', 'app_settings', 'd1_migrations', 'dev_only'].map(name => ({ type: 'table', name }));
  const calls = [], healthCalls = [], paths = new Set();
  let settingReads = 0, schemaReads = 0, imported;
  const beforeFiles = copyFiles(await readdir('.'));
  const beforeDirectories = copyDirectories(await readdir('.wrangler'));
  const env = {
    GITHUB_REF_NAME: 'main',
    CLOUDFLARE_API_TOKEN: 'fictional-test-token',
    CLOUDFLARE_ACCOUNT_ID: 'fictional-account',
    WRANGLER_CONFIG_JSON: JSON.stringify(development()),
    PRODUCTION_CONFIG_JSON: JSON.stringify(production())
  };
  const run = async args => {
    const path = argument(args, '--config');
    paths.add(path);
    const config = JSON.parse(await readFile(path, 'utf8'));
    calls.push({ args, config });
    if (args[1] === 'export') {
      const output = argument(args, '--output');
      paths.add(output);
      paths.add(dirname(output));
      // Also write before the synthetic failure to verify private export cleanup.
      await writeFile(output, sourceSql);
      if (failAt === 'export') throw new Error('Mock export failure.');
      return 'Mock export completed.';
    }
    if (args.includes('--file')) {
      const path = argument(args, '--file');
      paths.add(path);
      imported = await readFile(path, 'utf8');
      if (failAt === 'import') throw new Error('Mock import failure.');
      return 'Mock import completed.';
    }
    const command = argument(args, '--command');
    if (command.includes('sqlite_schema')) {
      schemaReads++;
      if (failAt === 'schema') throw new Error('Mock schema query failure.');
      if (failAt === 'response') return encoded([]).replace('true', 'false');
      return encoded(schemaRace && schemaReads > 1 ? [...schema, { type: 'table', name: 'new_dev_table' }] : schema);
    }
    if (command.includes('app_settings')) {
      settingReads++;
      if (failAt === 'settings') throw new Error('Mock settings query failure.');
      return encoded(settingsRace && settingReads > 1 ? settings.map(setting => setting.key === 'test-whitelist' ? { ...setting, value: '[]' } : setting) : settings);
    }
    throw new Error('Unexpected mocked database command.');
  };
  const fetcher = async (url, options) => {
    healthCalls.push({ url: String(url), options });
    if (unhealthy === 'network') throw new Error('Mock network failure.');
    if (unhealthy === 'invalid-json') return new Response('invalid JSON');
    return Response.json(unhealthy === 'missing-protection' ? { status: 'running' } : unhealthy === 'stopped' ? { status: 'stopped', databaseRefreshProtection: 1 } : { status: 'running', databaseRefreshProtection: 1 }, { status: unhealthy === 'http-error' ? 503 : 200 });
  };
  const assertCleaned = async () => {
    for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
    assert.deepEqual(copyFiles(await readdir('.')), beforeFiles);
    assert.deepEqual(copyDirectories(await readdir('.wrangler')), beforeDirectories);
  };
  return { env, run, fetcher, migrationsDirectory, calls, healthCalls, assertCleaned, get imported() { return imported; } };
}

test('DB refresh exports production read-only and imports exactly one replacement file into dev', async t => {
  const f = await fixture(t);
  const counts = await copyProductionDatabase(f);
  assert.equal(counts.events, 1);
  assert.equal(counts.appliedMigrations, 0);
  assert.equal(f.healthCalls.length, 1);
  assert.equal(f.healthCalls[0].url, 'https://development.test/');
  assert.ok(f.healthCalls[0].options.signal instanceof AbortSignal);
  const prodCalls = f.calls.filter(call => call.config.name === 'fictional-production');
  assert.equal(prodCalls.length, 1);
  assert.equal(prodCalls[0].args[1], 'export');
  assert.equal(prodCalls[0].config.vars.APP_ENV, 'production');
  assert.ok(prodCalls[0].args.includes('--remote'));
  assert.ok(!prodCalls[0].args.includes('--no-data'));
  const imports = f.calls.filter(call => call.args.includes('--file'));
  assert.equal(imports.length, 1);
  assert.equal(imports[0].config.name, 'fictional-development');
  assert.equal(imports[0].config.vars.APP_ENV, 'development');
  assert.ok(imports[0].args.includes('--yes'));
  assert.ok(f.calls.every(call => !['deploy', 'migrations'].includes(call.args[0]) && call.args[1] !== 'migrations'));
  const queries = f.calls.filter(call => call.args.includes('--command'));
  assert.equal(queries.length, 4);
  assert.ok(queries.every(call => call.config.name === 'fictional-development' && /^SELECT\b/.test(argument(call.args, '--command'))));
  assert.match(f.imported, /^PRAGMA defer_foreign_keys=ON;/);
  assert.match(f.imported, /DROP TABLE IF EXISTS "dev_only"/);
  await f.assertCleaned();
});

test('DB refresh refuses non-main runs and missing credentials before network or database calls', async t => {
  const f = await fixture(t);
  for (const env of [{ ...f.env, GITHUB_REF_NAME: 'dev' }, { ...f.env, CLOUDFLARE_API_TOKEN: '' }, { ...f.env, CLOUDFLARE_ACCOUNT_ID: '' }]) {
    await assert.rejects(copyProductionDatabase({ ...f, env }), /main|CLOUDFLARE/);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.healthCalls.length, 0);
  await f.assertCleaned();
});

test('DB refresh refuses shared production/dev resources before health checks or exports', async t => {
  const f = await fixture(t);
  for (const change of [
    (dev, prod) => { dev.d1_databases[0].database_id = prod.d1_databases[0].database_id; },
    (dev, prod) => { dev.name = prod.name; },
    (dev, prod) => { dev.vars.APP_URL = prod.vars.APP_URL; },
    (dev, prod) => { dev.vars.BOT_USERNAME = prod.vars.BOT_USERNAME; }
  ]) {
    const dev = development(), prod = production();
    change(dev, prod);
    await assert.rejects(copyProductionDatabase({ ...f, env: { ...f.env, WRANGLER_CONFIG_JSON: JSON.stringify(dev) } }), /different Worker/);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.healthCalls.length, 0);
  await f.assertCleaned();
});

test('DB refresh requires reachable dev health and deployed snapshot protection', async t => {
  for (const unhealthy of ['missing-protection', 'stopped', 'http-error', 'network', 'invalid-json']) {
    const f = await fixture(t, { unhealthy });
    await assert.rejects(copyProductionDatabase(f));
    assert.equal(f.healthCalls.length, 1);
    assert.equal(f.calls.length, 0);
    await f.assertCleaned();
  }
});

test('DB refresh refuses a changing whitelist before the sole dev import', async t => {
  const f = await fixture(t, { settingsRace: true });
  await assert.rejects(copyProductionDatabase(f), /settings changed/);
  assert.equal(f.calls.filter(call => call.args[1] === 'export').length, 1);
  assert.equal(f.calls.filter(call => call.args.includes('--file')).length, 0);
  await f.assertCleaned();
});

test('DB refresh refuses a changing dev schema before the sole dev import', async t => {
  const f = await fixture(t, { schemaRace: true });
  await assert.rejects(copyProductionDatabase(f), /schema or settings changed/);
  assert.equal(f.calls.filter(call => call.args.includes('--file')).length, 0);
  await f.assertCleaned();
});

test('DB refresh removes temporary configs and private snapshot files after operation failures', async t => {
  for (const failAt of ['export', 'schema', 'settings', 'response', 'import']) {
    const f = await fixture(t, { failAt });
    await assert.rejects(copyProductionDatabase(f));
    assert.equal(f.calls.filter(call => call.args.includes('--file')).length, failAt === 'import' ? 1 : 0);
    assert.ok(f.calls.filter(call => call.config.name === 'fictional-production').every(call => call.args[1] === 'export'));
    await f.assertCleaned();
  }
});

test('DB refresh refuses migration directories outside the checked-out workspace', async t => {
  const f = await fixture(t);
  await assert.rejects(copyProductionDatabase({ ...f, migrationsDirectory: resolve('..') }), /checked-out development source/);
  assert.equal(f.calls.length, 0);
  await f.assertCleaned();
});
