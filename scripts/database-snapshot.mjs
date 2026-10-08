import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const runtimeTables = ['outbox', 'processed', 'lease', 'delivery_lease', 'commits'];
const columnsRequired = {
  records: ['kind', 'id', 'data'],
  processed: ['id', 'at'],
  lease: ['id', 'owner', 'expires'],
  delivery_lease: ['id', 'owner', 'expires'],
  commits: ['owner'],
  outbox: ['id', 'method', 'params', 'due', 'attempts'],
  app_settings: ['key', 'value']
};
const invalid = () => new Error('The database snapshot could not be prepared safely. Development was not changed.');
const internal = name => /^(?:sqlite_|_cf_)/i.test(name);
const identifier = name => '"' + name.replaceAll('"', '""') + '"';
const validName = name => typeof name === 'string' && name.length > 0 && !name.includes('\0');

function rows(db, sql) {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all();
}

function schema(db) {
  const attached = rows(db, 'PRAGMA database_list');
  if (attached.some(row => row.name !== 'main' && row.name !== 'temp')) throw invalid();
  const tables = rows(db, 'PRAGMA table_list');
  // SQL dumps cannot faithfully restore virtual tables and their shadow state.
  if (tables.some(row => !internal(row.name) && (row.schema !== 'main' || !['table', 'view'].includes(row.type)))) throw invalid();
  const objects = rows(db, "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").filter(row => !internal(row.name));
  if (objects.some(row => !['table', 'view', 'index', 'trigger'].includes(row.type) || !validName(row.name) || typeof row.sql !== 'string')) throw invalid();
  return objects;
}

function validateRecords(db, objects) {
  const tableNames = new Set(objects.filter(row => row.type === 'table').map(row => row.name));
  for (const [table, names] of Object.entries(columnsRequired)) {
    if (!tableNames.has(table)) throw invalid();
    const columns = rows(db, `PRAGMA table_info(${identifier(table)})`);
    if (names.some(name => !columns.some(column => column.name === name))) throw invalid();
  }
  const columns = rows(db, 'PRAGMA table_info(records)');
  if (['kind', 'id', 'data'].some(name => !columns.some(column => column.name === name && column.type.toUpperCase() === 'TEXT'))) throw invalid();
  for (const record of rows(db, 'SELECT kind,id,data FROM records')) {
    if (![record.kind, record.id, record.data].every(value => typeof value === 'string') || !record.kind || !record.id) throw invalid();
    if (['events', 'users', 'preferences'].includes(record.kind)) {
      const value = JSON.parse(record.data);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    }
  }
}

function applyPendingMigrations(db, available) {
  if (!Array.isArray(available)) throw invalid();
  const byName = new Map();
  for (const migration of available) {
    if (!migration || !validName(migration.name) || typeof migration.sql !== 'string' || !migration.sql.trim() || byName.has(migration.name)) throw invalid();
    byName.set(migration.name, migration.sql);
  }
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='d1_migrations'").get();
  const applied = exists ? rows(db, 'SELECT name FROM d1_migrations') : [];
  if (applied.some(row => !byName.has(row.name))) throw new Error('Production uses migrations missing from development. Synchronize the reviewed migrations before copying the database.');
  if (!exists) db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  const completed = new Set(applied.map(row => row.name));
  const pending = [...byName.keys()].sort().filter(name => !completed.has(name));
  const record = db.prepare('INSERT INTO d1_migrations(name) VALUES (?)');
  for (const name of pending) {
    db.exec(byName.get(name));
    record.run(name);
  }
  return pending.length;
}

function literal(value, storageType) {
  // Read TEXT as bytes: Node 22's SQLite string conversion truncates embedded NULs.
  if (storageType === 'text' && value instanceof Uint8Array) return "CAST(X'" + Buffer.from(value).toString('hex') + "' AS TEXT)";
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const number = value.toString();
    // Integers are read as BigInt. A Number must retain SQLite's REAL storage class.
    return /[.e]/i.test(number) ? number : number + '.0';
  }
  if (typeof value === 'string') {
    // SQLite's SQL parser cannot accept a literal containing a NUL character.
    if (value.includes('\0')) return "CAST(X'" + Buffer.from(value, 'utf8').toString('hex') + "' AS TEXT)";
    return "'" + value.replaceAll("'", "''") + "'";
  }
  if (value instanceof Uint8Array) return "X'" + Buffer.from(value).toString('hex') + "'";
  throw invalid();
}

function dump(db, objects) {
  const sql = [];
  const tables = objects.filter(row => row.type === 'table');
  for (const table of tables) sql.push(table.sql + ';');
  for (const table of tables) {
    const allColumns = rows(db, `PRAGMA table_xinfo(${identifier(table.name)})`);
    const columns = allColumns.filter(column => column.hidden === 0n).map(column => column.name);
    if (!columns.length) throw invalid();
    const info = rows(db, 'PRAGMA table_list').find(row => row.schema === 'main' && row.name === table.name);
    // Keep accessible rowids too; they may be referenced by existing code or indexes.
    const rowid = info.wr === 0n ? ['_rowid_', 'rowid', 'oid'].find(name => !allColumns.some(column => column.name.toLowerCase() === name)) : undefined;
    const selected = rowid ? [rowid, ...columns] : columns;
    const names = selected.map(identifier).join(',');
    const expressions = selected.map(name => {
      const column = identifier(name);
      return `typeof(${column}),CASE WHEN typeof(${column})='text' THEN CAST(${column} AS BLOB) ELSE ${column} END`;
    }).join(',');
    const statement = db.prepare(`SELECT ${expressions} FROM ${identifier(table.name)}`);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    for (const row of statement.iterate()) {
      const values = selected.map((_, index) => literal(row[index * 2 + 1], row[index * 2]));
      sql.push(`INSERT INTO ${identifier(table.name)}(${names}) VALUES (${values.join(',')});`);
    }
  }
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence' AND type='table'").get()) {
    sql.push('DELETE FROM sqlite_sequence;');
    for (const row of rows(db, 'SELECT name,seq FROM sqlite_sequence ORDER BY name')) {
      if (!internal(row.name)) sql.push(`INSERT INTO sqlite_sequence(name,seq) VALUES (${literal(row.name)},${literal(row.seq)});`);
    }
  }
  // Guards, audit triggers, and indexes must be installed after copying table data.
  for (const type of ['index', 'view', 'trigger']) for (const object of objects.filter(row => row.type === type)) sql.push(object.sql + ';');
  return sql.join('\n');
}

function resetSql(developmentSchema, settings) {
  if (!Array.isArray(developmentSchema)) throw invalid();
  const objects = developmentSchema.filter(object => {
    if (!object || !['table', 'view'].includes(object.type) || !validName(object.name)) throw invalid();
    return !internal(object.name);
  });
  const unique = new Set();
  if (!objects.some(object => object.type === 'table' && object.name === 'app_settings')) throw invalid();
  const guard = identifier('_xevents_snapshot_guard_' + randomUUID().replaceAll('-', ''));
  const bytes = value => "X'" + Buffer.from(value, 'utf8').toString('hex') + "'";
  const exactSettings = [...settings].map(([key, value]) => `EXISTS (SELECT 1 FROM "app_settings" WHERE typeof("key")='text' AND CAST("key" AS BLOB)=${bytes(key)} AND typeof("value")='text' AND CAST("value" AS BLOB)=${bytes(value)})`);
  // Check again inside the same D1 import transaction, before resetting any data.
  // An external whitelist/settings edit after the API re-read aborts the import.
  const matches = [`(SELECT count(*) FROM "app_settings")=${settings.size}`, ...exactSettings].join(' AND ');
  const result = [
    'PRAGMA defer_foreign_keys=ON;',
    `CREATE TABLE ${guard}(ok INTEGER NOT NULL CHECK(ok=1));`,
    `INSERT INTO ${guard}(ok) SELECT CASE WHEN ${matches} THEN 1 ELSE 0 END;`,
    `DROP TABLE ${guard};`
  ];
  for (const type of ['view', 'table']) for (const object of objects.filter(row => row.type === type)) {
    const key = object.name.toLowerCase();
    if (unique.has(key)) throw invalid();
    unique.add(key);
    result.push(`DROP ${type.toUpperCase()} IF EXISTS ${identifier(object.name)};`);
  }
  return result.join('\n');
}

/** Build an atomic D1 replacement import entirely offline; never print SQL/data. */
export function prepareSnapshot({ sourceSql, developmentSchema, developmentSettings, migrations, copiedAt }) {
  let db;
  try {
    if (typeof sourceSql !== 'string' || !sourceSql.trim() || !Array.isArray(developmentSettings) || typeof copiedAt !== 'string' || !Number.isFinite(Date.parse(copiedAt))) throw invalid();
    const settings = new Map();
    for (const setting of developmentSettings) {
      if (!setting || !validName(setting.key) || typeof setting.value !== 'string' || settings.has(setting.key)) throw invalid();
      settings.set(setting.key, setting.value);
    }
    const reset = resetSql(developmentSchema, settings);
    db = new DatabaseSync(':memory:', { allowExtension: false });
    db.exec(sourceSql);
    schema(db);
    const appliedMigrations = applyPendingMigrations(db, migrations);
    const objects = schema(db);
    validateRecords(db, objects);
    // Cleanup must not run production audit/business triggers in the private staging DB.
    for (const trigger of objects.filter(row => row.type === 'trigger')) db.exec(`DROP TRIGGER ${identifier(trigger.name)}`);
    const removedSessions = Number(rows(db, "SELECT count(*) AS n FROM records WHERE kind='sessions'")[0].n);
    db.exec("DELETE FROM records WHERE kind='sessions'");
    for (const table of runtimeTables) db.exec(`DELETE FROM ${identifier(table)}`);
    db.exec('DELETE FROM app_settings');
    const set = db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?)');
    settings.set('production-snapshot', JSON.stringify({ version: 1, copiedAt }));
    for (const [key, value] of settings) set.run(key, value);
    if (rows(db, 'PRAGMA foreign_key_check').length || rows(db, 'PRAGMA integrity_check').some(row => row.integrity_check !== 'ok')) throw invalid();
    const grouped = rows(db, 'SELECT kind,count(*) AS n FROM records GROUP BY kind');
    const count = kind => Number(grouped.find(row => row.kind === kind)?.n || 0n);
    const counts = {
      records: grouped.reduce((total, row) => total + Number(row.n), 0),
      events: count('events'), users: count('users'), preferences: count('preferences'),
      removedSessions, tables: objects.filter(row => row.type === 'table').length, appliedMigrations
    };
    return { sql: reset + '\n' + dump(db, objects) + '\n', counts };
  } catch (error) {
    // SQLite errors can quote private values, SQL excerpts, or file paths.
    if (error?.message === 'Production uses migrations missing from development. Synchronize the reviewed migrations before copying the database.') throw error;
    throw invalid();
  } finally {
    db?.close();
  }
}
