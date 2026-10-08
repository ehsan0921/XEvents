import { readFile } from 'node:fs/promises';

const environments = { production: 'main', development: 'dev' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseConfig(raw) {
  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
    return config;
  } catch { throw new Error('Deployment configuration must be a valid private JSON object.'); }
}

export function validateConfig(config) {
  const db = config.d1_databases?.[0];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.name || '')) throw new Error('Worker name is missing or invalid.');
  if (config.d1_databases?.length !== 1 || db?.binding !== 'DB' || !uuid.test(db.database_id || '') || db.database_id === '00000000-0000-0000-0000-000000000000') throw new Error('A real, single D1 DB binding is required.');
  if (!/^[\w-]{1,63}$/.test(db.database_name || '')) throw new Error('D1 database name is missing or invalid.');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(config.vars?.BOT_USERNAME || '') || /YOUR_/i.test(config.vars.BOT_USERNAME)) throw new Error('Bot username is missing or invalid.');
  let app;
  try { app = new URL(config.vars?.APP_URL); } catch { throw new Error('A private HTTPS App URL is required.'); }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash || app.pathname !== '/app' || /YOUR_|example\.(com|org|net)$/i.test(app.hostname)) throw new Error('App URL must be HTTPS with the /app path and no launch data.');
  return { worker: config.name, database: db.database_id.toLowerCase(), databaseName: db.database_name, bot: config.vars.BOT_USERNAME.toLowerCase(), origin: app.origin };
}

export function validateSeparation(development, production) {
  const dev = validateConfig(development), prod = validateConfig(production);
  for (const key of ['worker', 'database', 'databaseName', 'bot', 'origin']) {
    if (dev[key] === prod[key]) throw new Error('Development must use a different Worker, D1 database, App origin and Telegram bot.');
  }
}

export function validateBranch(environment, branch) {
  if (!environments[environment] || environments[environment] !== branch) throw new Error('Only main can deploy production; only dev can deploy development.');
}

export async function buildConfig(privateConfig, environment) {
  validateConfig(privateConfig);
  const base = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  // Take code, asset bindings and runtime settings from reviewed source, never from a secret.
  return {
    ...base,
    name: privateConfig.name,
    vars: {
      BOT_USERNAME: privateConfig.vars.BOT_USERNAME,
      APP_URL: privateConfig.vars.APP_URL,
      APP_ENV: environment,
      TEST_WHITELIST_ENABLED: environment === 'development' && String(privateConfig.vars.TEST_WHITELIST_ENABLED).trim() === 'true' ? 'true' : 'false'
    },
    d1_databases: [{ binding: 'DB', database_name: privateConfig.d1_databases[0].database_name, database_id: privateConfig.d1_databases[0].database_id, migrations_dir: 'migrations' }],
    triggers: { crons: privateConfig.triggers?.crons ?? (environment === 'development' ? [] : base.triggers.crons) }
  };
}
