import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authenticate } from '../src/mini-auth.js';

const productionToken = 'fictional-production-bot-token';
const developmentToken = 'fictional-development-bot-token';
const now = 2_000_000_000;
const guest = { id: 111001, first_name: 'Test guest' };

function signed({ token = productionToken, date = now, user = guest, entries = [] } = {}) {
  const params = new URLSearchParams([
    ['query_id', 'fictional-query'],
    ['auth_date', String(date)],
    ['user', typeof user === 'string' ? user : JSON.stringify(user)],
    ...entries
  ]);
  const data = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return params.toString();
}

test('production accepts its signed session and rejects a development bot session', () => {
  assert.deepEqual(authenticate(signed(), productionToken, now), guest);
  assert.equal(authenticate(signed({ token: developmentToken }), productionToken, now), null);
  assert.equal(authenticate(signed(), developmentToken, now), null);
});

test('authentication accepts the freshness and clock-skew limits, then rejects expired or future sessions', () => {
  assert.deepEqual(authenticate(signed({ date: now - 3600 }), productionToken, now), guest);
  assert.equal(authenticate(signed({ date: now - 3601 }), productionToken, now), null);
  assert.deepEqual(authenticate(signed({ date: now + 30 }), productionToken, now), guest);
  assert.equal(authenticate(signed({ date: now + 31 }), productionToken, now), null);
  for (const date of ['not-a-date', now + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(authenticate(signed({ date }), productionToken, now), null);
  }
});

test('signed user names and launch parameters survive Unicode, URL encoding and query ordering', () => {
  const user = { id: 111002, first_name: 'Zoë & علی + 🎉', last_name: 'Guest\nName' };
  const data = signed({ user, entries: [['start_param', 'event_alpha+beta'], ['chat_instance', 'fixture-chat']] });
  const reversed = new URLSearchParams([...new URLSearchParams(data).entries()].reverse()).toString();
  assert.deepEqual(authenticate(reversed, productionToken, now), user);

  const changed = new URLSearchParams(reversed);
  changed.set('start_param', 'event_other');
  assert.equal(authenticate(changed.toString(), productionToken, now), null);
});

test('duplicate query parameters are rejected even when their complete contents were signed', () => {
  for (const entries of [
    [['auth_date', String(now)]],
    [['user', JSON.stringify({ id: 111003 })]],
    [['query_id', 'second-query']],
    [['start_param', 'first'], ['start_param', 'second']]
  ]) assert.equal(authenticate(signed({ entries }), productionToken, now), null);

  const params = new URLSearchParams(signed());
  params.append('hash', params.get('hash'));
  assert.equal(authenticate(params.toString(), productionToken, now), null);
});

test('a valid signature cannot turn a bot or malformed user identity into a human session', () => {
  for (const user of [
    null, {}, [], 'invalid-json',
    { id: '111001' }, { id: 0 }, { id: -1 }, { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { ...guest, is_bot: true }
  ]) assert.equal(authenticate(signed({ user }), productionToken, now), null);
});

test('missing credentials and malformed or oversized requests fail without throwing', () => {
  for (const input of [undefined, null, {}, 123, '', 'user=invalid', 'hash=short']) {
    assert.equal(authenticate(input, productionToken, now), null);
  }
  assert.equal(authenticate(signed(), undefined, now), null);
  assert.equal(authenticate(signed(), '', now), null);

  const oversized = signed({ entries: [['start_param', 'a'.repeat(12001)]] });
  assert.equal(authenticate(oversized, productionToken, now), null);

  const malformedHash = new URLSearchParams(signed());
  malformedHash.set('hash', 'z'.repeat(64));
  assert.equal(authenticate(malformedHash.toString(), productionToken, now), null);
});
