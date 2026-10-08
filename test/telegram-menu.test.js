import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMiniApp } from '../src/worker.js';
import { botCommands, botCommandsVersion } from '../src/telegram-menu.js';

function fixture(t, { commandVersion, commandResult = true } = {}) {
  const appUrl = 'https://example.test/app';
  const settings = new Map([['stars-webhook', appUrl], ['mini-menu', `App:${appUrl}`]]);
  if (commandVersion) settings.set('bot-commands', commandVersion);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = new URL(url).pathname.split('/').at(-1);
    calls.push({ method, ...JSON.parse(options.body) });
    return Response.json({ ok: method !== 'setMyCommands' || commandResult });
  });
  const env = {
    APP_URL: appUrl, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    DB: { prepare(sql) {
      const key = sql.match(/(?:key=|VALUES \()'([^']+)'/)?.[1];
      assert.ok(key, `Unexpected settings statement: ${sql}`);
      let value;
      return {
        bind(input) { value = input; return this; },
        async first() { return settings.has(key) ? { value: settings.get(key) } : null; },
        async run() { settings.set(key, value); }
      };
    } }
  };
  return { env, settings, calls };
}

test('existing bots update the short command menu even when their webhook and native App menu are current', async t => {
  const f = fixture(t);
  await configureMiniApp(f.env);
  assert.deepEqual(f.calls, [{ method: 'setMyCommands', commands: botCommands }]);
  assert.deepEqual(botCommands.map(item => item.command), ['help', 'cancel', 'paysupport']);
  assert.equal(f.settings.get('bot-commands'), botCommandsVersion);
  await configureMiniApp(f.env);
  assert.equal(f.calls.length, 1);
});

test('a failed command-menu update stays retryable and leaves the native App menu available', async t => {
  const f = fixture(t, { commandVersion: 'previous-menu', commandResult: false });
  await configureMiniApp(f.env);
  await configureMiniApp(f.env);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.method === 'setMyCommands'));
  assert.equal(f.settings.get('bot-commands'), 'previous-menu');
  assert.equal(f.settings.get('mini-menu'), `App:${f.env.APP_URL}`);
});

test('new bot configuration keeps the authenticated built-in App button alongside button navigation', async t => {
  const f = fixture(t);
  f.settings.clear();
  await configureMiniApp(f.env);
  assert.deepEqual(f.calls.map(call => call.method), ['setWebhook', 'setMyCommands', 'setChatMenuButton']);
  const menu = f.calls.at(-1).menu_button;
  assert.deepEqual(menu, { type: 'web_app', text: 'App', web_app: { url: f.env.APP_URL } });
  assert.equal(f.settings.get('stars-webhook'), f.env.APP_URL);
  assert.equal(f.settings.get('bot-commands'), botCommandsVersion);
});

test('the test whitelist command appears only in the configured admin private chat', async t => {
  const f = fixture(t, { commandVersion: botCommandsVersion });
  Object.assign(f.env, { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'true', SUPER_ADMIN_ID: '900000001' });
  await configureMiniApp(f.env);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].scope, { type: 'chat', chat_id: 900000001 });
  assert.deepEqual(f.calls[0].commands.map(item => item.command), ['help', 'cancel', 'paysupport', 'whitelist']);
  await configureMiniApp(f.env);
  assert.equal(f.calls.length, 1);
  f.env.TEST_WHITELIST_ENABLED = 'false';
  await configureMiniApp(f.env);
  assert.deepEqual(f.calls.at(-1).commands, botCommands);
  assert.deepEqual(f.calls.at(-1).scope, { type: 'chat', chat_id: 900000001 });
});

test('production never registers the test command even when its flag is enabled', async t => {
  const f = fixture(t, { commandVersion: botCommandsVersion });
  Object.assign(f.env, { APP_ENV: 'production', TEST_WHITELIST_ENABLED: 'true', SUPER_ADMIN_ID: '900000001' });
  await configureMiniApp(f.env);
  assert.deepEqual(f.calls, []);
});
