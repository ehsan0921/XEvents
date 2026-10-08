import { resolve } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { Store } from './store.js';
import { Bot } from './bot.js';
import { refundResult } from './payments.js';
import { botCommands } from './telegram-menu.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token === 'replace_with_your_bot_token') {
  console.error('Set TELEGRAM_BOT_TOKEN in .env first. See .env.example.'); process.exit(1);
}
const store = await new Store(resolve(process.env.DATA_DIR || './data')).load();
const lockPath = resolve(store.dir, 'bot.lock');
let lock;
try { lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); }
catch { console.error('Another bot may be running. If it stopped unexpectedly, remove data/bot.lock before restarting.'); process.exit(1); }
let stopping = false;
let bot;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; });

async function api(method, params = {}) {
  const {__broadcast,__broadcastDelete,__broadcastNotice,...safeParams}=params;
  // Never log URLs or raw fetch errors: Telegram URLs contain the token.
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(safeParams), signal: AbortSignal.timeout(45000)
    });
  } catch { throw new Error(`Telegram ${method}: network failure`); }
  const body = await response.json();
  if (!body.ok) {
    if(method==='refundStarPayment' && bot)await refundResult(bot,params.user_id,params.telegram_payment_charge_id,false);
    const error = new Error(`Telegram ${method} failed (${body.error_code})`);
    error.code = body.error_code; error.retryAfter = body.parameters?.retry_after;
    throw error;
  }
  if(method==='refundStarPayment' && bot)await refundResult(bot,params.user_id,params.telegram_payment_charge_id,true);
  return body.result;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  const me = await api('getMe');
  bot = new Bot(store, api, me.username);
  await api('deleteWebhook', { drop_pending_updates: false });
  await api('setMyCommands', { commands: botCommands });
  console.log(`@${me.username} is running. Press Ctrl+C to stop.`);
  while (!stopping) {
    try {
      const updates = await api('getUpdates', { offset: store.data.offset, timeout: 30, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
      for (const update of updates) {
        try { await bot.handle(update); }
        catch (error) {
          console.error(error.message.replaceAll(token, '[redacted]'));
          const chat = update.message?.chat?.id || update.callback_query?.from?.id;
          if (chat) await bot.home(chat, 'Something went wrong. Tap My events and try again.').catch(() => {});
        }
        store.data.offset = update.update_id + 1;
        await store.save();
      }
    } catch (error) {
      console.error(error.message.replaceAll(token, '[redacted]'));
      if ([401, 409].includes(error.code)) break;
      await delay(Math.min((error.retryAfter || 5) * 1000, 60000));
    }
  }
} catch (error) { console.error(error.message.replaceAll(token, '[redacted]')); process.exitCode = 1; }
finally { await lock.close(); await unlink(lockPath); }
