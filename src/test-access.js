import { isSuperAdmin } from './admin.js';
import { mutateState } from './worker-store.js';
import { snapshotActive } from './snapshot-mode.js';

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

export async function accessPolicy(env, force = false) {
  if (!whitelistEnabled(env) && !(force && env.APP_ENV === 'development')) return { enabled: false, ids: [], invalid: false };
  const stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key='test-whitelist'").first();
  let ids;
  if (stored) {
    try {
      const value = JSON.parse(stored.value);
      ids = Array.isArray(value) && value.every(id => typeof id === 'string' && validId(id)) ? [...new Set(value)] : null;
    } catch { ids = null; }
  } else ids = parseIds(env.WHITELIST_USER_IDS ?? '');
  return { enabled: true, ids: ids ?? [], invalid: ids === null };
}

export async function mayUseTestApp(env, user) {
  if (env.APP_ENV !== 'development' || isSuperAdmin(user, env)) return true;
  if (whitelistEnabled(env) && (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot)) return false;
  const snapshot = await snapshotActive(env);
  if (!whitelistEnabled(env) && !snapshot) return true;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot) return false;
  const policy = await accessPolicy(env, snapshot);
  return !policy.invalid && ((!snapshot && !policy.ids.length) || policy.ids.includes(String(user.id)));
}

function statusText(ids, snapshot = false) {
  if (snapshot) return ids.length ? `Database copy protected. Restricted to ${ids.length} tester${ids.length === 1 ? '' : 's'} and the super admin.` : 'Database copy protected. Only the super admin has access.';
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
    if (!whitelistEnabled(env) && !snapshot) return reply('Test whitelist is disabled in this environment.');
    const input = (command[2] || 'list').trim();
    const [operation, ...rest] = input.split(/\s+/);
    const action = operation.toLowerCase();
    if (!['list', 'add', 'remove', 'clear'].includes(action) || (['list', 'clear'].includes(action) && rest.length)) {
      return reply('Use /whitelist, /whitelist add ID, /whitelist remove ID, or /whitelist clear.');
    }
    const policy = await accessPolicy(env, snapshot);
    if (action !== 'clear' && policy.invalid) return reply('Whitelist configuration is invalid. Access is restricted. Use /whitelist clear to reset it.');
    if (action === 'list') {
      await reply(statusText(policy.ids, snapshot));
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
    settings.setAppSetting('test-whitelist', JSON.stringify(ids));
    await reply(statusText(ids, snapshot));
  }, update.update_id);
  return new Response('OK');
}
