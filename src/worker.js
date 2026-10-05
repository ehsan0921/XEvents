import { mutateState, BusyError } from './worker-store.js';
import { miniApi } from './mini-api.js';
import { rememberUser } from './admin.js';
import { sendDueReminders } from './reminders.js';
import { checkout, refundResult } from './payments.js';

export async function authorized(request, secret) {
  if (!secret) return false;
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([secret, supplied].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

async function telegram(env, method, params) {
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
    if (update.pre_checkout_query) {
      const decision = await mutateState(env, (data, bot) => checkout(bot, update.pre_checkout_query));
      const result = await telegram(env, 'answerPreCheckoutQuery', decision);
      return new Response(result.ok ? 'OK' : 'Retry', {status: result.ok ? 200 : 503});
    }
    const user = update.callback_query?.from || (update.message?.chat?.type === 'private' ? update.message.from : null);
    if (user) await rememberUser(env, user);
    await mutateState(env, (data, bot) => bot.handle(update), update.update_id);
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
    if (row.method === 'refundStarPayment' && (result.ok || [400,403].includes(result.error_code))) {
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
      if (response.ok && request.method === 'POST') ctx.waitUntil(drainOutbox(env));
      return response;
      } catch { return Response.json({ error: 'Could not load the planner. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    }
    if (request.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/' || ['/app.js', '/gallery.js', '/style.css'].includes(url.pathname))) {
      const target = new URL(request.url);
      if (url.pathname === '/app' || url.pathname === '/app/') target.pathname = '/';
      const asset = await env.ASSETS.fetch(new Request(target, request));
      const headers = new Headers(asset.headers);
      headers.set('Cache-Control', 'no-cache');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; base-uri 'self'; object-src 'none'");
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (request.method === 'GET' && url.pathname === '/') return Response.json({ service: 'XEvents', status: 'running' });
    if (url.pathname === '/setup' && request.method === 'POST') {
      if (!await authorized(request, env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });
      const me = await telegram(env, 'getMe', {});
      if (!me.ok) return Response.json({ configured: false, error: 'Bot token is invalid or unavailable' }, { status: 502 });
      if (me.result.username.toLowerCase() !== env.BOT_USERNAME.toLowerCase()) return Response.json({ configured: false, error: 'Bot username mismatch' }, { status: 409 });
      const hook = await telegram(env, 'setWebhook', { url: `${url.origin}/telegram`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'], drop_pending_updates: false });
      if (!hook.ok) return Response.json({ configured: false, error: 'Webhook setup failed', code: hook.error_code }, { status: 502 });
      await telegram(env, 'setMyCommands', { commands: [
        { command: 'new', description: 'Create an event' }, { command: 'events', description: 'Your events and invitations' },
        { command: 'cancel', description: 'Stop current input' }, { command: 'help', description: 'How XEvents works' }
      ] });
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
    ctx.waitUntil(configureMiniApp(env));
    ctx.waitUntil(mutateState(env, (data, bot) => sendDueReminders(data, bot)).then(() => drainOutbox(env)).catch(error => { if (!(error instanceof BusyError)) console.error('reminder_processing_failed'); }));
    ctx.waitUntil(env.DB.prepare('DELETE FROM processed WHERE at < unixepoch()-604800').run());
  }
};

export async function configureMiniApp(env) {
  if (!env.APP_URL) return;
  const payments = await env.DB.prepare("SELECT value FROM app_settings WHERE key='stars-webhook'").first();
  if(payments?.value !== env.APP_URL && env.TELEGRAM_WEBHOOK_SECRET) {
    const hook=await telegram(env,'setWebhook',{url:new URL('/telegram',env.APP_URL).href,secret_token:env.TELEGRAM_WEBHOOK_SECRET,max_connections:1,allowed_updates:['message','callback_query','pre_checkout_query'],drop_pending_updates:false});
    if(hook.ok) {
      const commands=await telegram(env,'setMyCommands',{commands:[{command:'new',description:'Create an event'},{command:'events',description:'Your events and invitations'},{command:'cancel',description:'Stop current input'},{command:'help',description:'How XEvents works'},{command:'paysupport',description:'Payment support and refunds'},{command:'terms',description:'Payment terms'}]});
      if(commands.ok)await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('stars-webhook',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(env.APP_URL).run();
    }
  }
  const setting = await env.DB.prepare("SELECT value FROM app_settings WHERE key='mini-menu'").first();
  if (setting?.value === env.APP_URL) return;
  const result = await telegram(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Planner', web_app: { url: env.APP_URL } } });
  if (result.ok) await env.DB.prepare("INSERT INTO app_settings(key,value) VALUES ('mini-menu',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(env.APP_URL).run();
}
