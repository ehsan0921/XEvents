import { isSuperAdmin } from './admin.js';
import { mutateState } from './worker-store.js';
import { snapshotActive } from './snapshot-mode.js';
import { InputError } from './time.js';

export const testAccessMessage = 'This test app is limited to approved testers.';
export class TestAccessError extends Error {
  constructor() { super(testAccessMessage); }
}
export const whitelistEnabled = env => env.APP_ENV === 'development' && String(env.TEST_WHITELIST_ENABLED).trim() === 'true';

function validId(value) {
  const text = String(value);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text));
}

function parseIds(value) {
  if (typeof value !== 'string') return null;
  if (!value.trim()) return [];
  const ids = value.split(/[,\s]+/).filter(Boolean);
  return ids.length && ids.every(validId) ? [...new Set(ids)] : null;
}

async function whitelistSwitch(env) {
  const stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key='test-whitelist-enabled'").first();
  if (!stored) return { enabled: whitelistEnabled(env), invalid: false };
  try {
    const enabled = JSON.parse(stored.value);
    if (typeof enabled === 'boolean') return { enabled, invalid: false };
  } catch {}
  // An invalid override must never quietly open a restricted test environment.
  return { enabled: true, invalid: true };
}

async function whitelistIds(env) {
  const stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key='test-whitelist'").first();
  let ids;
  if (stored) {
    try {
      const value = JSON.parse(stored.value);
      ids = Array.isArray(value) && value.every(id => typeof id === 'string' && validId(id)) ? [...new Set(value)] : null;
    } catch { ids = null; }
  } else ids = parseIds(env.WHITELIST_USER_IDS ?? '');
  return { ids: ids ?? [], invalid: ids === null };
}

export async function accessPolicy(env, force = false) {
  if (env.APP_ENV !== 'development') return { enabled: false, ids: [], invalid: false };
  const option = await whitelistSwitch(env);
  if (!option.enabled && !force) return { enabled: false, ids: [], invalid: false };
  const list = await whitelistIds(env);
  return { enabled: true, ids: list.ids, invalid: option.invalid || list.invalid };
}

function statusFrom(option, list, snapshot) {
  return {
    supported: true,
    enabled: option.enabled,
    restricted: snapshot || (option.enabled && (option.invalid || list.invalid || list.ids.length > 0)),
    ids: list.ids,
    snapshotProtected: snapshot,
    invalid: option.invalid || list.invalid
  };
}

export async function whitelistStatus(env) {
  if (env.APP_ENV !== 'development') return { supported: false, enabled: false, restricted: false, ids: [], snapshotProtected: false, invalid: false };
  const snapshot = await snapshotActive(env);
  return statusFrom(await whitelistSwitch(env), await whitelistIds(env), snapshot);
}

// Run inside mutateState, so simultaneous admin edits share its lease and batch.
export async function applyWhitelistChange(env, input, settings) {
  if (env.APP_ENV !== 'development') throw new InputError('The test whitelist is available only in development.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['set-enabled', 'add', 'remove'].includes(input.action)) throw new InputError('Choose a whitelist action.');
  const snapshot = await snapshotActive(env);
  const option = await whitelistSwitch(env);
  const list = await whitelistIds(env);
  if (input.action === 'set-enabled') {
    if (typeof input.enabled !== 'boolean') throw new InputError('Choose whether the whitelist is on or off.');
    if (snapshot && !input.enabled) throw new InputError('The whitelist must stay on while development contains copied production data.');
    option.enabled = input.enabled;
    option.invalid = false;
    settings.setAppSetting('test-whitelist-enabled', JSON.stringify(input.enabled));
  } else {
    const requested = typeof input.ids === 'string' && input.ids.length <= 12000 ? parseIds(input.ids) : null;
    if (!requested?.length || requested.length > 100) throw new InputError('Enter up to 100 numeric Telegram user IDs, separated by spaces or commas.');
    if (list.invalid && input.action !== 'add') throw new InputError('The whitelist is invalid. Add valid user IDs to reset it.');
    const ids = new Set(list.ids);
    for (const id of requested) input.action === 'add' ? ids.add(id) : ids.delete(id);
    if (input.action === 'add' && ids.size > 1000) throw new InputError('The whitelist can contain at most 1000 users.');
    list.ids = [...ids];
    list.invalid = false;
    settings.setAppSetting('test-whitelist', JSON.stringify(list.ids));
  }
  return statusFrom(option, list, snapshot);
}

export async function mayUseTestApp(env, user) {
  if (env.APP_ENV !== 'development' || isSuperAdmin(user, env)) return true;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot) return false;
  const snapshot = await snapshotActive(env);
  const policy = await accessPolicy(env, snapshot);
  if (!policy.enabled) return true;
  return !policy.invalid && ((!snapshot && !policy.ids.length) || policy.ids.includes(String(user.id)));
}

function statusText(ids, snapshot = false, enabled = true) {
  if (snapshot) return ids.length ? `Database copy protected. Restricted to ${ids.length} tester${ids.length === 1 ? '' : 's'} and the super admin.` : 'Database copy protected. Only the super admin has access.';
  if (!enabled) return 'Whitelist off. Open to everyone. Saved tester IDs are preserved.';
  return ids.length ? `Restricted to ${ids.length} tester${ids.length === 1 ? '' : 's'}. Super admin always has access.` : 'Whitelist empty. Open to everyone.';
}

export async function handleWhitelistCommand(env, update) {
  const message = update.message;
  if (message?.chat?.type !== 'private' || typeof message.text !== 'string') return null;
  const command = message.text.trim().match(/^\/whitelist(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
  if (!command || (command[1] && command[1].toLowerCase() !== String(env.BOT_USERNAME).toLowerCase())) return null;
  await mutateState(env, async (_data, bot, settings) => {
    const reply = text => bot.send(message.chat.id, text);
    if (!isSuperAdmin(message.from, env)) return reply('Only the super admin can manage test access.');
    const snapshot = !!bot.productionSnapshot;
    if (env.APP_ENV !== 'development') return reply('Test whitelist is disabled in this environment.');
    const input = (command[2] || 'list').trim();
    const [operation, ...rest] = input.split(/\s+/);
    const action = operation.toLowerCase();
    if (!['list', 'add', 'remove', 'clear'].includes(action) || (['list', 'clear'].includes(action) && rest.length)) {
      return reply('Use /whitelist, /whitelist add ID, /whitelist remove ID, or /whitelist clear.');
    }
    const status = await whitelistStatus(env);
    const policy = await accessPolicy(env, true);
    if (action !== 'clear' && policy.invalid) return reply('Whitelist configuration is invalid. Use /whitelist clear to reset it.');
    if (action === 'list') {
      await reply(statusText(policy.ids, snapshot, status.enabled));
      let page = '';
      for (const id of policy.ids) {
        if (page.length + id.length + 1 > 3500) { await reply(page); page = ''; }
        page += `${page ? '\n' : ''}${id}`;
      }
      if (page) await reply(page);
      return;
    }
    let ids = [];
    if (action !== 'clear') {
      const requested = parseIds(rest.join(' '));
      if (!requested?.length) return reply('Enter numeric Telegram user IDs, separated by spaces or commas.');
      const current = new Set(policy.ids);
      for (const id of requested) action === 'add' ? current.add(id) : current.delete(id);
      ids = [...current];
    }
    if (action === 'clear' && (await whitelistSwitch(env)).invalid) {
      status.enabled = whitelistEnabled(env);
      settings.setAppSetting('test-whitelist-enabled', JSON.stringify(status.enabled));
    }
    settings.setAppSetting('test-whitelist', JSON.stringify(ids));
    await reply(statusText(ids, snapshot, status.enabled));
  }, update.update_id);
  return new Response('OK');
}
