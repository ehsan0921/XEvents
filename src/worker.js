import { mutateState, BusyError } from './worker-store.js';
import { miniApi } from './mini-api.js';
import { isSuperAdmin, rememberUser } from './admin.js';
import { sendDueReminders } from './reminders.js';
import { checkout, refundResult } from './payments.js';
import {refreshOnlineRates} from './exchange.js';
import { botCommands, botCommandsVersion } from './telegram-menu.js';
import { handleWhitelistCommand, mayUseTestApp, testAccessMessage, whitelistEnabled } from './test-access.js';
import { snapshotActive, snapshotDeliveryAllowed } from './snapshot-mode.js';

export async function authorized(request, secret) {
  if (!secret) return false;
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([secret, supplied].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

async function telegram(env, method, params) {
  if (!await snapshotDeliveryAllowed(env, method, params)) return { ok: false, error_code: 403, snapshotBlocked: true };
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(method === 'answerPreCheckoutQuery' ? 5000 : 10000)
    });
  } catch { return { ok: false, error_code: 503 }; }
  try { return await response.json(); } catch { return { ok: false, error_code: 503 }; }
}

export async function processUpdate(env, update) {
  try {
    const user = update.pre_checkout_query?.from || update.callback_query?.from || (update.message?.chat?.type === 'private' ? update.message.from : null);
    // Payments already charged must still be recorded or refunded after access changes.
    if (user && !update.message?.successful_payment && !update.message?.refunded_payment && !await mayUseTestApp(env, user)) {
      if (update.pre_checkout_query) {
        const result = await telegram(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: false, error_message: testAccessMessage });
        return new Response(result.ok ? 'OK' : 'Retry', { status: result.ok ? 200 : 503 });
      }
      await mutateState(env, (_data, bot) => update.callback_query
        ? bot.api('answerCallbackQuery', { callback_query_id: update.callback_query.id, text: testAccessMessage, show_alert: true })
        : bot.send(update.message.chat.id, testAccessMessage), update.update_id);
      return new Response('OK');
    }
    const whitelistResponse = await handleWhitelistCommand(env, update);
    if (whitelistResponse) return whitelistResponse;
    if (update.pre_checkout_query) {
      const decision = await mutateState(env, (data, bot) => checkout(bot, update.pre_checkout_query));
      const result = await telegram(env, 'answerPreCheckoutQuery', decision);
      return new Response(result.ok ? 'OK' : 'Retry', {status: result.ok ? 200 : 503});
    }
    if (user) await rememberUser(env, user);
    await mutateState(env, async (data, bot) => {
      if (user && !update.message?.successful_payment && !update.message?.refunded_payment && !await mayUseTestApp(env, user)) {
        return update.callback_query
          ? bot.api('answerCallbackQuery', { callback_query_id: update.callback_query.id, text: testAccessMessage, show_alert: true })
          : bot.send(update.message.chat.id, testAccessMessage);
      }
      return bot.handle(update);
    }, update.update_id);
    return new Response('OK');
  } catch (e) {
    if (e instanceof BusyError) return new Response('Busy; retry', { status: 503 });
    throw e;
  }
}

export async function drainOutbox(env) {
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare('INSERT INTO delivery_lease(id,owner,expires) VALUES (1,?,unixepoch()+60) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE delivery_lease.expires<unixepoch() RETURNING owner').bind(owner).first();
  if (!lock) return;
  const deadline = Date.now() + 20000;
  try {
  const { results } = await env.DB.prepare('SELECT id,due FROM outbox ORDER BY rowid LIMIT 20').all();
  for (const { id, due } of results) {
    if (Date.now() > deadline || due > Math.floor(Date.now() / 1000)) break;
    const row = await env.DB.prepare('UPDATE outbox SET due=unixepoch()+60, attempts=attempts+1 WHERE id=? AND due<=unixepoch() RETURNING *').bind(id).first();
    if (!row) continue;
    const result = await telegram(env, row.method, JSON.parse(row.params));
    if (row.method === 'refundStarPayment' && !result.snapshotBlocked && (result.ok || [400,403].includes(result.error_code))) {
      const params=JSON.parse(row.params);
      await mutateState(env, (data,bot) => refundResult(bot,params.user_id,params.telegram_payment_charge_id,result.ok));
    }
    if (result.ok || [400, 403].includes(result.error_code)) {
      await env.DB.prepare('DELETE FROM outbox WHERE id=?').bind(id).run();
      if (!result.ok) console.log(JSON.stringify({ event: 'delivery_rejected', method: row.method, code: result.error_code }));
    } else {
      const seconds = Math.max(5, Math.min(result.parameters?.retry_after || 2 ** Math.min(row.attempts, 10), 3600));
      await env.DB.prepare('UPDATE outbox SET due=unixepoch()+? WHERE id=?').bind(seconds, id).run();
      break;
    }
  }
  } finally { await env.DB.prepare('DELETE FROM delivery_lease WHERE owner=?').bind(owner).run(); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
      const response = await miniApi(request, env);
      if (!response.ok) console.log(JSON.stringify({event:'mini_api_rejected',path:url.pathname,status:response.status}));
      if (response.ok && request.method === 'POST') ctx.waitUntil(drainOutbox(env));
      return response;
      } catch (error) { const reference=crypto.randomUUID();console.error(JSON.stringify({event:'mini_api_failed',reference,path:url.pathname,type:error.name})); return Response.json({ error: 'Could not load the planner. Please try again.',reference }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    }
    if (request.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/' || ['/app.js', '/errors.js', '/gallery.js', '/event-actions.js', '/style.css'].includes(url.pathname))) {
      const target = new URL(request.url);
      const appPage = url.pathname === '/app' || url.pathname === '/app/';
      if (appPage) target.pathname = '/';
      const assetRequest = new Request(target, request);
      if (appPage) {
        assetRequest.headers.delete('If-None-Match');
        assetRequest.headers.delete('If-Modified-Since');
      }
      const asset = await env.ASSETS.fetch(assetRequest);
      const headers = new Headers(asset.headers);
      if (appPage) {
        headers.delete('ETag');
        headers.delete('Last-Modified');
      }
      headers.set('Cache-Control', 'no-cache');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; base-uri 'self'; object-src 'none'");
      const response = new Response(asset.body, { status: asset.status, headers });
      if (appPage && asset.ok && typeof env.BOT_USERNAME === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(env.BOT_USERNAME)) {
        const botUrl = `https://t.me/${env.BOT_USERNAME}`;
        return new HTMLRewriter().on('#telegram-bot-link', {
          element(element) { element.setAttribute('href', botUrl); }
        }).transform(response);
      }
      return response;
    }
    if (request.method === 'GET' && url.pathname === '/') return Response.json({ service: 'XEvents', status: 'running', ...(env.APP_ENV === 'development' ? { databaseRefreshProtection: 1 } : {}) });
    if (url.pathname === '/setup' && request.method === 'POST') {
      if (!await authorized(request, env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });
      const me = await telegram(env, 'getMe', {});
      if (!me.ok) return Response.json({ configured: false, error: 'Bot token is invalid or unavailable' }, { status: 502 });
      if (me.result.username.toLowerCase() !== env.BOT_USERNAME.toLowerCase()) return Response.json({ configured: false, error: 'Bot username mismatch' }, { status: 409 });
      const hook = await telegram(env, 'setWebhook', { url: `${url.origin}/telegram`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'], drop_pending_updates: false });
      if (!hook.ok) return Response.json({ configured: false, error: 'Webhook setup failed', code: hook.error_code }, { status: 502 });
      await telegram(env, 'setMyCommands', { commands: botCommands });
      const info = await telegram(env, 'getWebhookInfo', {});
      return Response.json({ configured: true, bot: me.result.username, webhook: info.result?.url, pendingUpdates: info.result?.pending_update_count });
    }
    if (url.pathname !== '/telegram' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response('Not configured', { status: 503 });
    if (!await authorized(request, env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 1024 * 1024) return new Response('Too large', { status: 413 });
    let update;
    try { update = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response('Invalid JSON', { status: 400 }); }
    if (!Number.isSafeInteger(update.update_id)) return new Response('Invalid update', { status: 400 });
    try {
      const response = await processUpdate(env, update);
      if (response.ok) ctx.waitUntil(drainOutbox(env));
      return response;
    } catch {
      console.error(JSON.stringify({ event: 'update_failed', update_id: update.update_id }));
      return new Response('Retry later', { status: 503 });
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshOnlineRates(env).catch(()=>console.error('online_rates_storage_failed')));
    ctx.waitUntil(configureMiniApp(env));
    ctx.waitUntil((async () => {
      if (!await snapshotActive(env)) await mutateState(env, (data, bot) => bot.productionSnapshot ? undefined : sendDueReminders(data, bot));
      await drainOutbox(env);
    })().catch(error => { if (!(error instanceof BusyError)) console.error('reminder_processing_failed'); }));
    ctx.waitUntil(env.DB.prepare('DELETE FROM processed WHERE at < unixepoch()-604800').run());
  }
};

export async function configureMiniApp(env) {
  if (!env.APP_URL) return;
  const payments = await env.DB.prepare("SELECT value FROM app_settings WHERE key='stars-webhook'").first();
  if(payments?.value !== env.APP_URL && env.TELEGRAM_WEBHOOK_SECRET) {
    const hook=await telegram(env,'setWebhook',{url:new URL('/telegram',env.APP_URL).href,secret_token:env.TELEGRAM_WEBHOOK_SECRET,max_connections:1,allowed_updates:['message','callback_query','pre_checkout_query'],drop_pending_updates:false});
    if(hook.ok)await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('stars-webhook',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(env.APP_URL).run();
  }
  const commands = await env.DB.prepare("SELECT value FROM app_settings WHERE key='bot-commands'").first();
  if (commands?.value !== botCommandsVersion) {
    const result = await telegram(env, 'setMyCommands', { commands: botCommands });
    if (result.ok) await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('bot-commands',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(botCommandsVersion).run();
  }
  const adminId = Number(env.SUPER_ADMIN_ID);
  if (isSuperAdmin({ id: adminId }, env)) {
    const adminCommands = await env.DB.prepare("SELECT value FROM app_settings WHERE key='test-admin-commands'").first();
    const enabled = whitelistEnabled(env) || await snapshotActive(env);
    const version = `${botCommandsVersion}:${adminId}:${enabled}`;
    if ((enabled || adminCommands) && adminCommands?.value !== version) {
      const result = await telegram(env, 'setMyCommands', {
        scope: { type: 'chat', chat_id: adminId },
        commands: enabled ? [...botCommands, { command: 'whitelist', description: 'Manage test access' }] : botCommands
      });
      if (result.ok) await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('test-admin-commands',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(version).run();
    }
  }
  const setting = await env.DB.prepare("SELECT value FROM app_settings WHERE key='mini-menu'").first();
  const menuVersion=`App:${env.APP_URL}`;
  if (setting?.value === menuVersion) return;
  const result = await telegram(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'App', web_app: { url: env.APP_URL } } });
  if (result.ok) await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('mini-menu',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(menuVersion).run();
}
