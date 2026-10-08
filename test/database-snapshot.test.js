import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareSnapshot } from '../scripts/database-snapshot.mjs';

const copiedAt = '2026-10-08T04:30:00.000Z';
const migrations = ['0001_initial.sql', '0002_delivery_lease.sql', '0003_mini_app.sql'].map(name => ({ name, sql: readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8') }));
const core = migrations.map(migration => migration.sql).join('\n');
const metadata = 'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);\n' + migrations.map(({ name }) => `INSERT INTO d1_migrations(name,applied_at) VALUES ('${name}','2026-01-01');`).join('\n');
const source = extra => core + '\n' + metadata + '\n' + (extra || '');
const initialSchema = ['records', 'processed', 'lease', 'commits', 'outbox', 'delivery_lease', 'app_settings'].map(name => ({ type: 'table', name }));
const options = extra => ({ sourceSql: source(), developmentSchema: initialSchema, developmentSettings: [], migrations, copiedAt, ...extra });

function open(sql = '') {
  const db = new DatabaseSync(':memory:');
  if (sql) db.exec(sql);
  return db;
}

function developmentSchema(db) {
  return db.prepare("SELECT type,name FROM sqlite_schema WHERE type IN ('table','view')").all();
}

function apply(db, sql) {
  try { db.exec('BEGIN;\n' + sql + '\nCOMMIT;'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function restore(sql) {
  const db = open(core);
  apply(db, sql);
  return db;
}

function value(db, sql) {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.get();
}

test('snapshot replaces nonempty development and can be copied repeatedly', () => {
  const db = open(core + "INSERT INTO records VALUES('events','old','{\"title\":\"Old test event\"}'); CREATE TABLE dev_only(value TEXT); INSERT INTO dev_only VALUES('old'); CREATE VIEW old_view AS SELECT value FROM dev_only;");
  try {
    const sourceSql = source("INSERT INTO records VALUES('events','source-event','{\"title\":\"Future gathering\",\"invitationMode\":\"legacy\"}');");
    for (let attempt = 0; attempt < 2; attempt++) {
      const prepared = prepareSnapshot(options({ sourceSql, developmentSchema: developmentSchema(db), developmentSettings: db.prepare('SELECT key,value FROM app_settings ORDER BY key').all() }));
      apply(db, prepared.sql);
      assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1);
      assert.equal(db.prepare('SELECT id FROM records').get().id, 'source-event');
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('dev_only','old_view')").get().n, 0);
      assert.equal(prepared.counts.events, 1);
      assert.equal(prepared.counts.appliedMigrations, 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 3);
    }
  } finally { db.close(); }
});

test('snapshot clears sessions and delivery state while retaining the dev whitelist and settings', () => {
  const sourceSql = source(`
    INSERT INTO records VALUES('sessions','900000001','{"step":"upload","eventId":"source-event"}');
    INSERT INTO records VALUES('events','source-event','{"title":"Fixture event"}');
    INSERT INTO outbox(id,method,params) VALUES('queued','sendMessage','{"chat_id":900000001,"text":"Fixture"}');
    INSERT INTO processed VALUES(100,1);
    INSERT INTO lease VALUES(1,'fixture-owner',9223372036854775807);
    INSERT INTO delivery_lease VALUES(1,'fixture-owner',9223372036854775807);
    INSERT INTO commits VALUES('fixture-owner');
    INSERT INTO app_settings VALUES('test-whitelist','["900000002"]');
    INSERT INTO app_settings VALUES('mini-menu','App:https://production.test/app');
  `);
  const developmentSettings = [{ key: 'test-whitelist', value: '["900000003"]' }, { key: 'mini-menu', value: 'App:https://development.test/app' }, { key: 'empty-setting', value: '' }];
  const { sql, counts } = prepareSnapshot(options({ sourceSql, developmentSettings }));
  const db = open(core);
  try {
    for (const { key, value } of developmentSettings) db.prepare('INSERT INTO app_settings VALUES(?,?)').run(key, value);
    apply(db, sql);
    for (const table of ['outbox', 'processed', 'lease', 'delivery_lease', 'commits']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='sessions'").get().n, 0);
    for (const setting of developmentSettings) assert.equal(db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting.key).value, setting.value);
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key='production-snapshot'").get().value), { version: 1, copiedAt });
    assert.equal(counts.removedSessions, 1);
    assert.equal(counts.records, 1);
    assert.doesNotMatch(sql, /production\.test|fixture-owner|900000001|900000002/);
  } finally { db.close(); }
});

test('empty development settings do not inherit a production whitelist or endpoint', () => {
  const { sql } = prepareSnapshot(options({ sourceSql: source("INSERT INTO app_settings VALUES('test-whitelist','[\"900000002\"]'); INSERT INTO app_settings VALUES('stars-webhook','https://production.test/telegram');") }));
  const db = restore(sql);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM app_settings').get().n, 1);
    assert.equal(db.prepare('SELECT key FROM app_settings').get().key, 'production-snapshot');
    assert.doesNotMatch(sql, /900000002|production\.test/);
  } finally { db.close(); }
});

test('event ownership, invitation, media, payment, refund and user JSON stay byte-for-byte unchanged', () => {
  const raw = '{ "id":"event-one", "owner":900000001, "invitationMode":"named", "guests":{"900000002":{"status":"yes","participants":2,"ticketCode":"fixture-ticket","payment":{"status":"paid","chargeId":"fixture-charge","refund":{"status":"complete"}},"checkedInAt":"2026-10-07"}}, "invitations":[{"token":"fixture-token","claimedBy":900000002,"oneTime":true}], "media":[{"fileId":"fixture-file","name":"Photo.jpg"}], "location":"Guest location", "title":"L’été — میهمانی" }';
  const user = '{ "id":900000002,"username":"fixture_user","firstName":"O\'Brien","phone":"fictional optional phone" }';
  const preference = '{ "timezone":"Australia/Sydney","photo":"fixture-profile-file" }';
  const sourceSql = source() + [
    ['events', 'event-one', raw], ['users', '900000002', user], ['preferences', '900000002', preference], ['future-business', 'other', 'arbitrary legacy data']
  ].map(row => 'INSERT INTO records VALUES(' + row.map(text => "'" + text.replaceAll("'", "''") + "'").join(',') + ');').join('\n');
  const { sql, counts } = prepareSnapshot(options({ sourceSql }));
  const db = restore(sql);
  try {
    for (const [kind, expected] of [['events', raw], ['users', user], ['preferences', preference], ['future-business', 'arbitrary legacy data']]) assert.equal(db.prepare('SELECT data FROM records WHERE kind=?').get(kind).data, expected);
    assert.equal(counts.records, 4);
    assert.equal(counts.events, 1);
    assert.equal(counts.users, 1);
    assert.equal(counts.preferences, 1);
  } finally { db.close(); }
});

test('SQL literals preserve quoted Unicode, NUL text, blobs, REAL values and exact 64-bit integers', () => {
  const sourceSql = source(`CREATE TABLE payload(id INTEGER PRIMARY KEY, text_value TEXT, bytes BLOB, exact INTEGER, floating, nullable);
    INSERT INTO payload VALUES(7,'O''Brien — میهمانی\nnext line',X'00ff1027',9223372036854775807,1.0,NULL);
    INSERT INTO payload VALUES(8,CAST(X'610062' AS TEXT),X'',-9223372036854775808,-1.25,NULL);`);
  const { sql } = prepareSnapshot(options({ sourceSql }));
  const db = restore(sql);
  try {
    const first = value(db, 'SELECT * FROM payload WHERE id=7');
    assert.equal(first.text_value, "O'Brien — میهمانی\nnext line");
    assert.deepEqual(first.bytes, new Uint8Array([0, 255, 16, 39]));
    assert.equal(first.exact, 9223372036854775807n);
    assert.equal(first.floating, 1);
    assert.equal(db.prepare('SELECT typeof(floating) AS kind FROM payload WHERE id=7').get().kind, 'real');
    assert.equal(first.nullable, null);
    const second = value(db, 'SELECT * FROM payload WHERE id=8');
    // Node 22's SQLite TEXT reader stops at NUL; compare the actual stored bytes.
    assert.equal(db.prepare('SELECT hex(CAST(text_value AS BLOB)) AS bytes FROM payload WHERE id=8').get().bytes, '610062');
    assert.deepEqual(second.bytes, new Uint8Array());
    assert.equal(second.exact, -9223372036854775808n);
  } finally { db.close(); }
});

test('pending development migrations run once and keep original applied metadata', () => {
  const pending = { name: '0004_example.sql', sql: 'ALTER TABLE records ADD COLUMN extra TEXT DEFAULT \'example\'; CREATE INDEX records_extra ON records(extra);' };
  const { sql, counts } = prepareSnapshot(options({ migrations: [...migrations, pending], sourceSql: source("INSERT INTO records VALUES('events','fixture','{}');") }));
  const db = restore(sql);
  try {
    assert.equal(db.prepare('SELECT extra FROM records').get().extra, 'example');
    assert.equal(db.prepare("SELECT applied_at FROM d1_migrations WHERE name='0001_initial.sql'").get().applied_at, '2026-01-01');
    assert.equal(db.prepare("SELECT count(*) AS n FROM d1_migrations WHERE name='0004_example.sql'").get().n, 1);
    assert.equal(counts.appliedMigrations, 1);
    // Treat the completed snapshot as the next source; ALTER must not run again.
    const repeatSource = source("INSERT INTO records VALUES('events','fixture','{}');" + pending.sql + "INSERT INTO d1_migrations(name) VALUES('0004_example.sql');");
    const repeat = prepareSnapshot(options({ sourceSql: repeatSource, migrations: [...migrations, pending], developmentSchema: developmentSchema(db), developmentSettings: db.prepare('SELECT key,value FROM app_settings ORDER BY key').all() }));
    apply(db, repeat.sql);
    assert.equal(repeat.counts.appliedMigrations, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 4);
  } finally { db.close(); }
});

test('missing migration fails before returning an import and keeps private names out of errors', () => {
  assert.throws(() => prepareSnapshot(options({ sourceSql: source("INSERT INTO d1_migrations(name) VALUES('9999_private_example.sql');") })), error => /migrations missing/.test(error.message) && !error.message.includes('9999_private_example'));
});

test('unrecorded initial migrations can initialize metadata without duplicating application rows', () => {
  const { sql, counts } = prepareSnapshot(options({ sourceSql: core + "INSERT INTO records VALUES('events','fixture','{}');" }));
  const db = restore(sql);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1);
    assert.equal(counts.appliedMigrations, 3);
  } finally { db.close(); }
});

test('development identifiers are quoted safely and platform internals are never dropped', () => {
  const unusual = 'unusual"; DROP TABLE records;--';
  const db = open(core + 'CREATE TABLE "' + unusual.replaceAll('"', '""') + '"(value TEXT); CREATE TABLE _cf_KV(key TEXT,value TEXT); INSERT INTO _cf_KV VALUES(\'fixture\',\'platform state\');');
  try {
    const { sql } = prepareSnapshot(options({ developmentSchema: developmentSchema(db) }));
    assert.doesNotMatch(sql, /DROP TABLE IF EXISTS "(?:_cf_KV|sqlite_sequence)"/i);
    apply(db, sql);
    assert.equal(db.prepare('SELECT value FROM _cf_KV').get().value, 'platform state');
    assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE name=?').get(unusual).n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 0);
  } finally { db.close(); }
});

test('auto-increment high-water marks and generated columns survive a snapshot', () => {
  const { sql } = prepareSnapshot(options({ sourceSql: source(`CREATE TABLE sequence_example(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT,length INTEGER GENERATED ALWAYS AS (length(value)) STORED);
    INSERT INTO sequence_example(id,value) VALUES(5,'fixture'); INSERT INTO sequence_example(id,value) VALUES(99,'deleted'); DELETE FROM sequence_example WHERE id=99;`) }));
  const db = restore(sql);
  try {
    assert.equal(db.prepare('SELECT length FROM sequence_example').get().length, 7);
    db.prepare('INSERT INTO sequence_example(value) VALUES (?)').run('next');
    assert.equal(db.prepare("SELECT id FROM sequence_example WHERE value='next'").get().id, 100);
  } finally { db.close(); }
});

test('rowids and WITHOUT ROWID tables survive while generated aliases remain read-only', () => {
  const { sql } = prepareSnapshot(options({ sourceSql: source(`
    CREATE TABLE rowid_example(value TEXT,"_rowid_" INTEGER GENERATED ALWAYS AS (length(value)) VIRTUAL);
    INSERT INTO rowid_example(rowid,value) VALUES(45,'fixture');
    CREATE TABLE natural_key(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID;
    INSERT INTO natural_key VALUES('fixture',9223372036854775807);
  `) }));
  const db = restore(sql);
  try {
    assert.equal(value(db, 'SELECT rowid FROM rowid_example').rowid, 45n);
    assert.equal(db.prepare('SELECT "_rowid_" AS n FROM rowid_example').get().n, 7);
    assert.equal(value(db, 'SELECT b FROM natural_key').b, 9223372036854775807n);
  } finally { db.close(); }
});

test('indexes, views and lease guards are restored after data without replaying business triggers', () => {
  const { sql } = prepareSnapshot(options({ sourceSql: source(`CREATE TABLE audit(value TEXT); CREATE INDEX audit_value ON audit(value);
    CREATE TRIGGER record_audit AFTER INSERT ON records BEGIN INSERT INTO audit VALUES(NEW.id); END;
    CREATE VIEW event_titles AS SELECT id FROM records WHERE kind='events';
    INSERT INTO records VALUES('events','fixture-event','{}');
    CREATE TRIGGER delete_audit AFTER DELETE ON records BEGIN INSERT INTO audit VALUES('deleted'); END;
    INSERT INTO records VALUES('sessions','fixture-session','{}');`) }));
  const db = restore(sql);
  try {
    assert.deepEqual(db.prepare('SELECT value FROM audit ORDER BY value').all().map(row => row.value), ['fixture-event', 'fixture-session']);
    assert.equal(db.prepare('SELECT id FROM event_titles').get().id, 'fixture-event');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='index' AND name='audit_value'").get().n, 1);
    assert.throws(() => db.prepare("INSERT INTO commits VALUES('lost')").run(), /lease lost/);
    db.prepare("INSERT INTO records VALUES('events','new-event','{}')").run();
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE value='new-event'").get().n, 1);
    assert.ok(sql.lastIndexOf('CREATE TRIGGER') > sql.lastIndexOf('INSERT INTO'));
  } finally { db.close(); }
});

test('virtual tables and unsupported extensions fail safely without emitting SQL or private values', () => {
  for (const extra of ["CREATE VIRTUAL TABLE private_search USING fts5(private_text);", "SELECT load_extension('private-extension-path');", "INSERT INTO missing_private_table VALUES('private-fixture-value');"]) {
    assert.throws(() => prepareSnapshot(options({ sourceSql: source(extra) })), error => /could not be prepared safely/.test(error.message) && !/private|load_extension|missing_private_table/.test(error.message));
  }
});

test('malformed core records and schema fail before any replacement SQL is returned', () => {
  for (const extra of [
    "INSERT INTO records VALUES('events','fixture','not valid JSON');",
    "INSERT INTO records VALUES('users','fixture','null');",
    "INSERT INTO records VALUES('preferences','fixture','[]');",
    'DROP TABLE outbox;',
    'DROP TABLE records; CREATE TABLE records(kind INTEGER,id TEXT,data TEXT);'
  ]) assert.throws(() => prepareSnapshot(options({ sourceSql: source(extra) })), /could not be prepared safely/);
});

test('invalid development settings, schema and timestamps produce generic errors', () => {
  for (const change of [
    { developmentSettings: [{ key: 'key', value: 'one' }, { key: 'key', value: 'two' }] },
    { developmentSettings: [{ key: 'key', value: null }] },
    { developmentSchema: [{ type: 'table', name: 'invalid\0name' }] },
    { developmentSchema: [{ type: 'trigger', name: 'invalid' }] },
    { developmentSchema: [{ type: 'table', name: 'records' }, { type: 'table', name: 'records' }] },
    { copiedAt: 'private invalid value' }
  ]) assert.throws(() => prepareSnapshot(options(change)), error => /could not be prepared safely/.test(error.message) && !error.message.includes('private'));
});

test('atomic settings guard aborts a stale snapshot without resetting data or overwriting current settings', () => {
  for (const change of [
    db => db.exec("UPDATE app_settings SET value='[]' WHERE key='test-whitelist'"),
    db => db.exec("INSERT INTO app_settings VALUES('new-setting','current')"),
    db => db.exec("DELETE FROM app_settings WHERE key='test-whitelist'"),
    db => db.exec("UPDATE app_settings SET key='renamed-setting' WHERE key='test-whitelist'"),
    db => db.exec("UPDATE app_settings SET value=CAST(value AS BLOB) WHERE key='test-whitelist'"),
    db => db.exec("UPDATE app_settings SET key=CAST(key AS BLOB) WHERE key='test-whitelist'")
  ]) {
    const db = open(core + "INSERT INTO records VALUES('events','current-dev-event','{\"title\":\"Keep current dev data\"}'); INSERT INTO app_settings VALUES('test-whitelist','[\"900000001\"]');");
    try {
      const developmentSettings = db.prepare('SELECT key,value FROM app_settings').all();
      const { sql } = prepareSnapshot(options({ sourceSql: source("INSERT INTO records VALUES('events','new-snapshot-event','{}');"), developmentSchema: developmentSchema(db), developmentSettings }));
      change(db);
      const current = db.prepare('SELECT hex(CAST(key AS BLOB)) AS keyBytes,hex(CAST(value AS BLOB)) AS valueBytes,typeof(key) AS keyType,typeof(value) AS valueType FROM app_settings ORDER BY key').all();
      assert.throws(() => apply(db, sql), /CHECK constraint failed/);
      assert.equal(db.prepare('SELECT id FROM records').get().id, 'current-dev-event');
      assert.deepEqual(db.prepare('SELECT hex(CAST(key AS BLOB)) AS keyBytes,hex(CAST(value AS BLOB)) AS valueBytes,typeof(key) AS keyType,typeof(value) AS valueType FROM app_settings ORDER BY key').all(), current);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name GLOB '_xevents_snapshot_guard_*'").get().n, 0);
    } finally { db.close(); }
  }
});

test('atomic settings guard compares exact text bytes and requires an initialized dev settings table', () => {
  assert.throws(() => prepareSnapshot(options({ developmentSchema: [{ type: 'table', name: 'records' }] })), /could not be prepared safely/);
  const db = open(core);
  try {
    const developmentSettings = [{ key: 'quote\' — نام', value: 'a\0b' }];
    db.prepare('INSERT INTO app_settings VALUES(?,?)').run(developmentSettings[0].key, developmentSettings[0].value);
    const { sql } = prepareSnapshot(options({ developmentSettings }));
    assert.ok(sql.indexOf('CHECK(ok=1)') < sql.indexOf('DROP TABLE IF EXISTS "records"'));
    apply(db, sql);
    assert.equal(db.prepare('SELECT hex(CAST(value AS BLOB)) AS bytes FROM app_settings WHERE key=?').get(developmentSettings[0].key).bytes, '610062');
  } finally { db.close(); }
});
