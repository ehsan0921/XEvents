import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, validateSeparation, buildConfig } from './deployment-config.mjs';
import { temporaryConfig, wrangler, jsonOutput, requireCredentials } from './deployment-tools.mjs';

export function schemaOnly(sql) {
  // Validate a schema-only export before any D1 write. Never accept data-changing SQL.
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|DETACH)\b/i.test(sql.replace(/CREATE\s+TRIGGER\b[\s\S]*?\bEND\s*;/gi, ''))) throw new Error('The export is not schema-only; development was not changed.');
  return sql;
}

export function assertEmpty(rows, expected = rows?.length) {
  if (!Array.isArray(rows) || rows.length !== expected || rows.some(row => row.n !== 0)) throw new Error('Development contains test data or could not be checked. Schema copying only runs against an empty development database; no data was overwritten.');
}

export function queryRows(result) {
  if (!Array.isArray(result) || !result.length || result.some(statement => statement.success !== true || !Array.isArray(statement.results))) throw new Error('Development database could not be checked; no data was overwritten.');
  return result.flatMap(statement => statement.results);
}

export function migrationNames(rows, available) {
  const names = rows.map(row => row.name);
  if (names.some(name => typeof name !== 'string' || !/^\d+_[A-Za-z0-9_-]+\.sql$/.test(name) || !available.includes(name))) throw new Error('Production uses migrations absent from the reviewed source. Synchronize source before copying schema.');
  return [...new Set(names)].sort();
}

export function migrationMetadataSql(names) {
  migrationNames(names.map(name => ({ name })), names);
  if (!names.length) return '';
  return '\nCREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);\n' + names.map(name => "INSERT INTO d1_migrations(name) SELECT '" + name + "' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='" + name + "');").join('\n');
}

async function readMigrations(config, available) {
  const tables = queryRows(jsonOutput(await wrangler(['d1', 'execute', 'DB', '--remote', '--config', config, '--json', '--command', "SELECT name FROM sqlite_schema WHERE type='table' AND name='d1_migrations'"])));
  if (!tables.length) return [];
  return migrationNames(queryRows(jsonOutput(await wrangler(['d1', 'execute', 'DB', '--remote', '--config', config, '--json', '--command', 'SELECT name FROM d1_migrations ORDER BY name']))), available);
}

async function refresh() {
  if (process.env.GITHUB_REF_NAME !== 'main') throw new Error('Production-to-development schema copying must run from main.');
  requireCredentials();
  const dev = parseConfig(process.env.WRANGLER_CONFIG_JSON), prod = parseConfig(process.env.PRODUCTION_CONFIG_JSON);
  validateSeparation(dev, prod);
  const development = await temporaryConfig(await buildConfig(dev, 'development'), 'ci-dev');
  const production = await temporaryConfig(await buildConfig(prod, 'production'), 'ci-prod');
  const directory = resolve('.wrangler/ci'), exported = resolve(directory, 'production-schema.sql');
  await mkdir(directory, { recursive: true });
  try {
    const result = jsonOutput(await wrangler(['d1', 'execute', 'DB', '--remote', '--config', development.path, '--json', '--command', "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name!='d1_migrations'"]));
    const tables = queryRows(result).map(row => row.name);
    if (tables.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Unexpected development schema; no data was overwritten.');
    if (tables.length) {
      const counts = jsonOutput(await wrangler(['d1', 'execute', 'DB', '--remote', '--config', development.path, '--json', '--command', tables.map(name => 'SELECT COUNT(*) AS n FROM "' + name + '"').join(';')]));
      assertEmpty(queryRows(counts), tables.length);
    }
    const available = await readdir('migrations');
    const applied = await readMigrations(production.path, available);
    await wrangler(['d1', 'export', 'DB', '--remote', '--config', production.path, '--no-data', '--output', exported]);
    const after = await readMigrations(production.path, available);
    if (JSON.stringify(applied) !== JSON.stringify(after)) throw new Error('Production schema changed during export. Retry after the production deployment finishes; development was not changed.');
    const sql = schemaOnly(await readFile(exported, 'utf8'));
    // Existing empty tables keep their schema. Apply reviewed migrations to evolve them.
    const compatible = sql.replace(/CREATE TABLE (?!IF NOT EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/gi, 'CREATE $1INDEX IF NOT EXISTS ').replace(/CREATE TRIGGER (?!IF NOT EXISTS)/gi, 'CREATE TRIGGER IF NOT EXISTS ');
    // Migration names are schema metadata, not application data. Preserve them so
    // an ALTER TABLE already reflected in the export is not replayed on development.
    await writeFile(exported, compatible + migrationMetadataSql(applied), { mode: 0o600 });
    await wrangler(['d1', 'execute', 'DB', '--remote', '--config', development.path, '--file', exported, '--yes']);
    await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', development.path]);
    console.log('Production database structure copied to empty development D1. No event, user, media, payment or delivery data was copied.');
  } finally {
    await Promise.all([development.cleanup(), production.cleanup(), rm(exported, { force: true })]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await refresh(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
