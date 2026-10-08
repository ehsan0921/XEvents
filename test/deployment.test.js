import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseConfig, validateBranch, validateConfig, validateSeparation, buildConfig } from '../scripts/deployment-config.mjs';
import { schemaOnly, assertEmpty, queryRows, migrationNames, migrationMetadataSql } from '../scripts/refresh-development.mjs';

const production = () => ({ name: 'fictional-production', vars: { BOT_USERNAME: 'FictionalProductionBot', APP_URL: 'https://production.test/app' }, d1_databases: [{ binding: 'DB', database_name: 'fictional-production-db', database_id: '11111111-1111-4111-8111-111111111111' }] });
const development = () => ({ name: 'fictional-development', vars: { BOT_USERNAME: 'FictionalDevelopmentBot', APP_URL: 'https://development.test/app' }, d1_databases: [{ binding: 'DB', database_name: 'fictional-development-db', database_id: '22222222-2222-4222-8222-222222222222' }] });

test('only main targets production and only dev targets development', () => {
  validateBranch('production', 'main'); validateBranch('development', 'dev');
  for (const [environment, branch] of [['production', 'dev'], ['development', 'main'], ['production', 'feature'], ['preview', 'dev'], ['development', undefined]]) assert.throws(() => validateBranch(environment, branch), /Only main/);
});

test('development rejects every production resource collision before remote changes', () => {
  validateSeparation(development(), production());
  for (const change of [
    (dev, prod) => { dev.name = prod.name; },
    (dev, prod) => { dev.d1_databases[0].database_id = prod.d1_databases[0].database_id.toUpperCase(); },
    (dev, prod) => { dev.d1_databases[0].database_name = prod.d1_databases[0].database_name; },
    (dev, prod) => { dev.vars.BOT_USERNAME = prod.vars.BOT_USERNAME.toUpperCase(); },
    (dev, prod) => { dev.vars.APP_URL = prod.vars.APP_URL; }
  ]) { const dev = development(), prod = production(); change(dev, prod); assert.throws(() => validateSeparation(dev, prod), /different Worker/); }
});

test('invalid configuration reports no private input or parser excerpts', () => {
  assert.throws(() => parseConfig('{"private":"https://private.test"'), error => !/private\.test/.test(error.message));
  for (const raw of [undefined, '[]', 'null', 'false']) assert.throws(() => parseConfig(raw), /private JSON object/);
  for (const app of ['http://development.test/app', 'https://development.test/app?token=fictional', 'https://user:secret@development.test/app', 'https://development.test/app#initData=fictional', 'https://example.com/app']) {
    const dev = development(); dev.vars.APP_URL = app;
    assert.throws(() => validateConfig(dev), error => !error.message.includes(app));
  }
  const dev = development(); dev.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000';
  assert.throws(() => validateConfig(dev), /real, single D1/);
});

test('generated config takes application and assets from source and never includes credentials', async () => {
  const dev = development(); dev.main = 'untrusted.js'; dev.assets = { directory: '../private' }; dev.vars.TELEGRAM_BOT_TOKEN = 'fictional-secret'; dev.vars.WHITELIST_USER_IDS = '900000001,900000002'; dev.triggers = { crons: [] }; dev.env = { production: production() };
  const config = await buildConfig(dev, 'development');
  assert.equal(config.main, 'src/worker.js'); assert.equal(config.assets.directory, './public');
  assert.equal(config.assets.binding, 'ASSETS'); assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.d1_databases[0].migrations_dir, 'migrations');
  assert.equal(config.vars.APP_ENV, 'development'); assert.deepEqual(config.triggers.crons, []);
  assert.equal(config.vars.TELEGRAM_BOT_TOKEN, undefined); assert.equal(config.vars.WHITELIST_USER_IDS, undefined); assert.equal(config.env, undefined);
  assert.doesNotMatch(JSON.stringify(config), /fictional-secret|900000001|900000002|untrusted|private/);
});

test('test whitelist enablement is explicit and limited to development', async () => {
  assert.equal((await buildConfig(development(), 'development')).vars.TEST_WHITELIST_ENABLED, 'false');
  for (const value of ['true', ' true ', true]) {
    const dev = development(); dev.vars.TEST_WHITELIST_ENABLED = value;
    assert.equal((await buildConfig(dev, 'development')).vars.TEST_WHITELIST_ENABLED, 'true');
    const prod = production(); prod.vars.TEST_WHITELIST_ENABLED = value;
    assert.equal((await buildConfig(prod, 'production')).vars.TEST_WHITELIST_ENABLED, 'false');
  }
  for (const value of ['false', 'TRUE', '1', '', false, null]) {
    const dev = development(); dev.vars.TEST_WHITELIST_ENABLED = value;
    assert.equal((await buildConfig(dev, 'development')).vars.TEST_WHITELIST_ENABLED, 'false');
  }
});

test('development cron stays disabled until explicitly configured', async () => {
  assert.deepEqual((await buildConfig(development(), 'development')).triggers.crons, []);
  assert.deepEqual((await buildConfig(production(), 'production')).triggers.crons, ['* * * * *']);
});

test('schema copy refuses nonempty data and incomplete database responses', () => {
  assertEmpty([], 0); assertEmpty([{ n: 0 }, { n: 0 }], 2);
  for (const [rows, count] of [[[{ n: 1 }], 1], [[{ n: '0' }], 1], [[], 1], [null, 0], [[{}], 1]]) assert.throws(() => assertEmpty(rows, count), /no data was overwritten/);
  assert.deepEqual(queryRows([{ success: true, results: [{ name: 'records' }] }]), [{ name: 'records' }]);
  for (const result of [[], {}, [{ success: false, results: [] }], [{ success: true }]]) assert.throws(() => queryRows(result), /could not be checked/);
});

test('schema copy accepts DDL and lease triggers but rejects data or destructive operations', () => {
  const schema = 'CREATE TABLE records(kind TEXT); CREATE TRIGGER require_lease BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, \'lease lost\'); END;';
  assert.equal(schemaOnly(schema), schema);
  for (const sql of ["INSERT INTO records VALUES('private');", 'UPDATE records SET kind=1;', 'DELETE FROM records;', 'REPLACE INTO records VALUES(1);', 'DROP TABLE records;', 'ALTER TABLE records ADD COLUMN data TEXT;', "ATTACH DATABASE 'other' AS other;"]) assert.throws(() => schemaOnly(sql), /not schema-only/);
});

test('migration metadata prevents replaying ALTER TABLE migrations and accepts only reviewed names', () => {
  const names = ['0001_initial.sql', '0004_example.sql'];
  assert.deepEqual(migrationNames([{name:names[1]}, {name:names[0]}], names), names);
  assert.throws(() => migrationNames([{name:'9999_unknown.sql'}], names), /absent from/);
  assert.throws(() => migrationMetadataSql(["bad'); DROP TABLE records;--"]), /absent from/);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE records(kind TEXT, extra TEXT);' + migrationMetadataSql(names));
    const pending = names.filter(name => !db.prepare('SELECT name FROM d1_migrations WHERE name=?').get(name));
    for (const name of pending) if(name === '0004_example.sql') db.exec('ALTER TABLE records ADD COLUMN extra TEXT;');
    assert.deepEqual(pending, []);
    db.exec(migrationMetadataSql(names));
    assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 0);
  } finally { db.close(); }
});
