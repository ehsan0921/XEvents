import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { drainOutbox, processUpdate } from '../src/worker.js';
import { snapshotActive, snapshotDeliveryAllowed, snapshotPaymentMessage } from '../src/snapshot-mode.js';
import { invoice, checkout, requestRefund } from '../src/payments.js';
import { miniApi } from '../src/mini-api.js';
import { createHmac } from 'node:crypto';

function apiRequest(path, input) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 111001, first_name: 'Fictional tester' }), query_id: 'fictional-snapshot-query' });
  const text = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update('snapshot-test-token').digest();
  params.set('hash', createHmac('sha256', key).update(text).digest('hex'));
  return new Request('https://fictional.test/api/' + path, { method: input ? 'POST' : 'GET', headers: { Authorization: 'tma ' + params.toString(), 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
}

function fixture({ snapshot = { value: '{}' }, stored = { value: '["111002"]' }, ...variables } = {}) {
  return {
    APP_ENV: 'development', SUPER_ADMIN_ID: '999001', ...variables,
    DB: {
      prepare(sql) {
        if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return { async first() { return snapshot; } };
        if (sql === "SELECT value FROM app_settings WHERE key='test-whitelist'") return { async first() { return stored; } };
        assert.fail('Unexpected database query.');
      }
    }
  };
}

test('only development activates the snapshot marker and any marker value protects data', async () => {
  for (const value of ['', 'null', 'false', 'not-json', null]) assert.equal(await snapshotActive(fixture({ snapshot: { value } })), true);
  assert.equal(await snapshotActive(fixture({ snapshot: null })), false);
  for (const APP_ENV of ['production', undefined, 'preview']) {
    const env = { APP_ENV, DB: { prepare() { assert.fail('Production must ignore the marker.'); } } };
    assert.equal(await snapshotActive(env), false);
    assert.equal(await snapshotDeliveryAllowed(env, 'refundStarPayment', { user_id: 111001 }), true);
  }
});

test('copied database deliveries only reach admin and explicitly listed testers', async () => {
  const env = fixture({ TEST_WHITELIST_ENABLED: 'false' });
  for (const chat_id of [999001, '999001', 111002, '111002']) assert.equal(await snapshotDeliveryAllowed(env, 'sendMessage', { chat_id }), true);
  for (const chat_id of [111001, -111002, 0, '@FictionalChannel', '00111002', Number.MAX_SAFE_INTEGER + 1]) assert.equal(await snapshotDeliveryAllowed(env, 'sendMessage', { chat_id }), false);
  assert.equal(await snapshotDeliveryAllowed(env, 'sendMessage', { chat_id: 999001, user_id: 111001 }), false);
  assert.equal(await snapshotDeliveryAllowed(env, 'sendMessage', { user_id: 111002 }), true);
  assert.equal(await snapshotDeliveryAllowed(env, 'setMyCommands', { scope: { type: 'chat', chat_id: 999001 } }), true);
  assert.equal(await snapshotDeliveryAllowed(env, 'answerCallbackQuery', { callback_query_id: 'fictional-callback' }), true);
});

test('empty and malformed tester lists fail closed for outbound snapshot delivery', async () => {
  for (const stored of [{ value: '[]' }, { value: 'not-json' }, null]) {
    const env = fixture({ stored });
    assert.equal(await snapshotDeliveryAllowed(env, 'sendPhoto', { chat_id: 111002 }), false);
    assert.equal(await snapshotDeliveryAllowed(env, 'sendPhoto', { chat_id: 999001 }), true);
  }
});

test('snapshot financial methods are blocked for every recipient', async () => {
  for (const method of ['sendInvoice', 'createInvoiceLink', 'refundStarPayment']) {
    assert.equal(await snapshotDeliveryAllowed(fixture(), method, { chat_id: 999001, user_id: 999001 }), false);
    assert.equal(await snapshotDeliveryAllowed(fixture({ snapshot: null }), method, { chat_id: 111001 }), true);
  }
});

test('payment entry points leave imported orders and guest payment audit unchanged', async () => {
  const event = { id: 'fictional', guests: { 111002: { payment: { status: 'paid', order: 'fictional-order' } } } };
  const order = { id: 'fictional-order', charge: 'fictional-charge', status: 'paid' };
  const before = JSON.stringify({ event, order });
  const sent = [];
  const bot = { productionSnapshot: true, send: async (...args) => sent.push(args), api() { assert.fail('No financial API request is permitted.'); } };
  await invoice(bot, 111002, event, true);
  assert.deepEqual(checkout(bot, { id: 'fictional-checkout' }), { pre_checkout_query_id: 'fictional-checkout', ok: false, error_message: snapshotPaymentMessage });
  await requestRefund(bot, 111002, order);
  assert.equal(JSON.stringify({ event, order }), before);
  assert.deepEqual(sent, [[111002, snapshotPaymentMessage], [111002, snapshotPaymentMessage]]);
});

test('development health advertises database refresh safeguards without exposing configuration', async () => {
  for (const APP_ENV of ['production', 'development']) {
    const response = await worker.fetch(new Request('https://fictional.test/'), { APP_ENV }, {});
    const body = await response.json();
    assert.equal(body.databaseRefreshProtection, APP_ENV === 'development' ? 1 : undefined);
    assert.deepEqual(Object.keys(body).sort(), APP_ENV === 'development' ? ['databaseRefreshProtection', 'service', 'status'] : ['service', 'status']);
  }
});

test('suppressed refund deliveries do not contact Telegram or rewrite imported audit state', async t => {
  const env = fixture();
  const base = env.DB.prepare.bind(env.DB), removed = [];
  const refund = { id: 'fictional-refund', due: 0, method: 'refundStarPayment', params: JSON.stringify({ user_id: 111002, telegram_payment_charge_id: 'fictional-charge' }) };
  env.DB.prepare = sql => {
    if (sql.startsWith('INSERT INTO delivery_lease')) return { bind() { return this; }, async first() { return { owner: 'fictional-lease' }; } };
    if (sql === 'SELECT id,due FROM outbox ORDER BY rowid LIMIT 20') return { async all() { return { results: [refund] }; } };
    if (sql.startsWith('UPDATE outbox SET due=unixepoch()+60')) return { bind() { return this; }, async first() { return refund; } };
    if (sql === 'DELETE FROM outbox WHERE id=?') return { bind(id) { removed.push(id); return this; }, async run() {} };
    if (sql === 'DELETE FROM delivery_lease WHERE owner=?') return { bind() { return this; }, async run() {} };
    return base(sql);
  };
  t.mock.method(globalThis, 'fetch', () => assert.fail('Suppressed refunds must never reach Telegram.'));
  await drainOutbox(env);
  assert.deepEqual(removed, ['fictional-refund']);
});

test('snapshot scheduler preserves reminder state while configuration and rates tasks remain available', async () => {
  const env = fixture(), base = env.DB.prepare.bind(env.DB), pending = [];
  env.DB.prepare = sql => {
    if (sql === 'SELECT value FROM app_settings WHERE key=?') return { bind() { return this; }, async first() { return { value: JSON.stringify({ retrievedAt: new Date().toISOString() }) }; } };
    if (sql.startsWith('INSERT INTO delivery_lease')) return { bind() { return this; }, async first() { return null; } };
    if (sql === 'DELETE FROM processed WHERE at < unixepoch()-604800') return { async run() {} };
    return base(sql);
  };
  await worker.scheduled({}, env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  assert.equal(pending.length, 4);
});

test('a Mini App read crossing the database refresh cannot return copied private event data', async () => {
  let copied = false;
  const event = { id: '1110000000000001', owner: 111001, title: 'Private copied event fixture', when: 'Future', guests: {}, startsAt: '2099-01-01T00:00:00Z', location: 'Private copied venue fixture' };
  const env = { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 'snapshot-test-token', BOT_USERNAME: 'FictionalSnapshotBot', DB: {
    prepare(sql) {
      if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return { async first() { return copied ? { value: '{}' } : null; } };
      if (sql === "SELECT value FROM app_settings WHERE key='test-whitelist'") return { async first() { return { value: '[]' }; } };
      if (sql === "SELECT data FROM records WHERE kind='events' AND id=?") return { bind() { return this; }, async first() { copied = true; return { data: JSON.stringify(event) }; } };
      assert.fail('Unexpected database query.');
    }
  } };
  const response = await miniApi(apiRequest('events/' + event.id), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /Private copied|venue|1110000000000001/);
});

test('a Mini App mutation rechecks access under its lease before loading copied records', async () => {
  let copied = false, released = false;
  const env = { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 'snapshot-test-token', snapshotUser: { id: 999001 }, SUPER_ADMIN_ID: '999001', DB: {
    prepare(sql) {
      if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return { async first() { return copied ? { value: '{}' } : null; } };
      if (sql === "SELECT value FROM app_settings WHERE key='test-whitelist'") return { async first() { return { value: '[]' }; } };
      if (sql.startsWith('INSERT INTO lease')) return { bind() { return this; }, async first() { copied = true; return { owner: 'fictional-lease' }; } };
      if (sql === 'DELETE FROM lease WHERE owner=?') return { bind() { return this; }, async run() { released = true; } };
      assert.fail('Blocked mutations must not read or write copied application records.');
    }
  } };
  const response = await miniApi(apiRequest('preferences', { timezone: 'UTC', snapshotUser: { id: 999001 } }), env);
  assert.equal(response.status, 403);
  assert.equal(released, true);
  assert.match((await response.json()).error, /test|access/i);
});

test('a Telegram callback crossing a refresh does not render the copied event', async () => {
  let copied = false;
  const queued = [];
  const event = { id: '1110000000000001', owner: 111001, title: 'Private copied Telegram fixture', guests: {}, location: 'Private copied venue' };
  const env = { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'false', BOT_USERNAME: 'FictionalSnapshotBot', DB: {
    prepare(sql) {
      if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return { async first() { return copied ? { value: '{}' } : null; } };
      if (sql === "SELECT value FROM app_settings WHERE key='test-whitelist'") return { async first() { return { value: '[]' }; } };
      if (sql.startsWith('INSERT INTO lease')) return { bind() { return this; }, async first() { copied = true; return { owner: 'fictional-lease' }; } };
      if (sql.startsWith("INSERT INTO records(kind,id,data) VALUES ('users'")) return { bind() { return this; }, async run() {} };
      if (sql === 'SELECT id FROM processed WHERE id=?') return { bind() { return this; }, async first() { return null; } };
      if (sql === "SELECT kind,id,data FROM records WHERE kind IN ('events','sessions','preferences')") return { async all() { return { results: [{ kind: 'events', id: event.id, data: JSON.stringify(event) }] }; } };
      if (sql === 'SELECT value FROM app_settings WHERE key=?') return { bind() { return this; }, async first() { return null; } };
      if (sql === 'INSERT INTO outbox(id,method,params) VALUES (?,?,?)') return { bind(id, method, params) { queued.push({ id, method, params: JSON.parse(params) }); return this; } };
      if (['INSERT INTO commits(owner) VALUES (?)', 'INSERT INTO processed(id,at) VALUES (?,unixepoch())', 'DELETE FROM commits WHERE owner=?'].includes(sql)) return { bind() { return this; } };
      if (sql === 'DELETE FROM lease WHERE owner=?') return { bind() { return this; }, async run() {} };
      assert.fail('The blocked callback must not mutate copied application records.');
    },
    async batch() {}
  } };
  const response = await processUpdate(env, { update_id: 1111001, callback_query: { id: 'fictional-racing-callback', from: { id: 111001, first_name: 'Fictional tester' }, data: 'v:' + event.id } });
  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].method, 'answerCallbackQuery');
  assert.match(queued[0].params.text, /test|access/i);
  assert.doesNotMatch(JSON.stringify(queued), /Private copied/);
});
