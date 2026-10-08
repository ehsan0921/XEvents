import test from 'node:test';
import assert from 'node:assert/strict';
import { accessPolicy, mayUseTestApp, whitelistEnabled, whitelistStatus, applyWhitelistChange, handleWhitelistCommand } from '../src/test-access.js';

const development = { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'true' };

function fixture({ stored = null, snapshot = null, override = null, seed = '', ...variables } = {}) {
  let reads = 0;
  const env = {
    ...development,
    WHITELIST_USER_IDS: seed,
    ...variables,
    DB: {
      prepare(sql) {
        if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return { async first() { return snapshot; } };
        if (sql === "SELECT value FROM app_settings WHERE key='test-whitelist-enabled'") return { async first() { return override; } };
        assert.equal(sql, "SELECT value FROM app_settings WHERE key='test-whitelist'");
        return { async first() { reads++; return stored; } };
      }
    }
  };
  return { env, reads: () => reads };
}

test('test access requires both the development environment and its explicit switch', () => {
  assert.equal(whitelistEnabled(development), true);
  assert.equal(whitelistEnabled({ ...development, TEST_WHITELIST_ENABLED: ' true ' }), true);
  for (const env of [
    {},
    { APP_ENV: 'development' },
    { ...development, TEST_WHITELIST_ENABLED: 'false' },
    { ...development, TEST_WHITELIST_ENABLED: '' },
    { ...development, APP_ENV: 'production' },
    { TEST_WHITELIST_ENABLED: 'true' }
  ]) assert.equal(whitelistEnabled(env), false);
});

test('production ignores the test list without reading its database', async () => {
  const env = {
    ...development,
    APP_ENV: 'production',
    WHITELIST_USER_IDS: 'malformed',
    DB: { prepare() { assert.fail('Production must not read the test whitelist.'); } }
  };
  assert.deepEqual(await accessPolicy(env), { enabled: false, ids: [], invalid: false });
  assert.equal(await mayUseTestApp(env, { id: 111001 }), true);
});

test('disabling the test access switch preserves open development access', async () => {
  const { env } = fixture({ TEST_WHITELIST_ENABLED: 'false', seed: '111002' });
  assert.deepEqual(await accessPolicy(env), { enabled: false, ids: [], invalid: false });
  assert.equal(await mayUseTestApp(env, { id: 111001 }), true);
});

test('database copies require explicit testers even when the whitelist switch is disabled', async () => {
  const { env } = fixture({ snapshot: { value: '' }, TEST_WHITELIST_ENABLED: 'false', seed: '111002', SUPER_ADMIN_ID: '999001' });
  assert.equal(await mayUseTestApp(env, { id: 111002 }), true);
  assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
  assert.equal(await mayUseTestApp(env, { id: 999001 }), true);
  assert.deepEqual(await accessPolicy(env, true), { enabled: true, ids: ['111002'], invalid: false });
});

test('an empty or malformed list never opens a production database copy', async () => {
  for (const stored of [null, { value: '[]' }, { value: 'not-json' }]) {
    const { env } = fixture({ snapshot: { value: 'not-json' }, stored, SUPER_ADMIN_ID: '999001' });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
    assert.equal(await mayUseTestApp(env, { id: 999001 }), true);
  }
});

test('forcing test access policy still cannot enable a production restriction', async () => {
  const env = { APP_ENV: 'production', DB: { prepare() { assert.fail('Production must not read copied database restrictions.'); } } };
  assert.deepEqual(await accessPolicy(env, true), { enabled: false, ids: [], invalid: false });
  assert.equal(await mayUseTestApp(env, { id: 111001 }), true);
});

test('an absent or blank seed opens access to verified human users', async () => {
  for (const seed of ['', ' \n\t ', undefined, null]) {
    const { env } = fixture({ seed });
    assert.deepEqual(await accessPolicy(env), { enabled: true, ids: [], invalid: false });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), true);
  }
});

test('seed IDs accept commas and whitespace and remove duplicates', async () => {
  const { env } = fixture({ seed: '111001, 111002\n111001\t111003' });
  assert.deepEqual(await accessPolicy(env), { enabled: true, ids: ['111001', '111002', '111003'], invalid: false });
  assert.equal(await mayUseTestApp(env, { id: 111002 }), true);
  assert.equal(await mayUseTestApp(env, { id: 111004 }), false);
});

test('an explicitly cleared stored list overrides a populated or invalid seed', async () => {
  for (const seed of ['111002', 'malformed']) {
    const { env } = fixture({ stored: { value: '[]' }, seed });
    assert.deepEqual(await accessPolicy(env), { enabled: true, ids: [], invalid: false });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), true);
  }
});

test('stored tester IDs override the seed and remove duplicates', async () => {
  const { env } = fixture({ stored: { value: '["111002","111002","111003"]' }, seed: '111001' });
  assert.deepEqual(await accessPolicy(env), { enabled: true, ids: ['111002', '111003'], invalid: false });
  assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
  assert.equal(await mayUseTestApp(env, { id: 111003 }), true);
});

test('malformed nonempty seeds fail closed', async () => {
  for (const seed of [',,', '111001;111002', '111001,invalid', '0', '-1', '00111001', '1.1', '1e5', '9007199254740992', 111001, ['111001']]) {
    const { env } = fixture({ seed });
    assert.deepEqual(await accessPolicy(env), { enabled: true, ids: [], invalid: true });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
  }
});

test('malformed stored values fail closed rather than falling back to an open seed', async () => {
  for (const value of ['not-json', '', 'null', '{}', '"111001"', '[111001]', '["111001",null]', '["0"]', '["00111001"]', '["9007199254740992"]', null]) {
    const { env } = fixture({ stored: { value }, seed: '' });
    assert.deepEqual(await accessPolicy(env), { enabled: true, ids: [], invalid: true });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
  }
});

test('the configured super admin bypasses invalid policy and database failure', async () => {
  const env = {
    ...development,
    SUPER_ADMIN_ID: '999001\n',
    WHITELIST_USER_IDS: 'malformed',
    DB: { prepare() { assert.fail('Super admin access must not depend on the whitelist database.'); } }
  };
  assert.equal(await mayUseTestApp(env, { id: 999001 }), true);
});

test('client flags or malformed administrator configuration cannot bypass the list', async () => {
  for (const SUPER_ADMIN_ID of ['', 'invalid', '0999001', '9007199254740992']) {
    const { env } = fixture({ seed: '111002', SUPER_ADMIN_ID });
    assert.equal(await mayUseTestApp(env, { id: 999001, isSuperAdmin: true, username: 'admin' }), false);
  }
});

test('development access rejects unverified identity shapes before reading the policy', async () => {
  const { env, reads } = fixture();
  for (const user of [null, {}, { id: '111001' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 111001, is_bot: true }]) {
    assert.equal(await mayUseTestApp(env, user), false);
  }
  assert.equal(reads(), 0);
});

test('database failure cannot silently open development access', async () => {
  const env = {
    ...development,
    DB: { prepare() { return { async first() { throw new Error('Database unavailable'); } }; } }
  };
  await assert.rejects(accessPolicy(env), /Database unavailable/);
  await assert.rejects(mayUseTestApp(env, { id: 111001 }), /Database unavailable/);
});

test('a stored switch overrides environment defaults without redeployment', async () => {
  const disabled = fixture({ override: { value: 'false' }, seed: '111002' }).env;
  assert.equal(await mayUseTestApp(disabled, { id: 111001 }), true);
  assert.deepEqual(await accessPolicy(disabled), { enabled: false, ids: [], invalid: false });
  assert.deepEqual(await whitelistStatus(disabled), { supported: true, enabled: false, restricted: false, ids: ['111002'], snapshotProtected: false, invalid: false });
  const enabled = fixture({ TEST_WHITELIST_ENABLED: 'false', override: { value: 'true' }, seed: '111002' }).env;
  assert.equal(await mayUseTestApp(enabled, { id: 111001 }), false);
  assert.equal(await mayUseTestApp(enabled, { id: 111002 }), true);
});

test('malformed stored switches fail closed, including with an empty tester list', async () => {
  for (const value of ['', 'null', '"false"', '0', '{}', 'not-json']) {
    const { env } = fixture({ override: { value }, TEST_WHITELIST_ENABLED: 'false', SUPER_ADMIN_ID: '999001' });
    assert.deepEqual(await accessPolicy(env), { enabled: true, ids: [], invalid: true });
    assert.equal(await mayUseTestApp(env, { id: 111001 }), false);
    assert.equal(await mayUseTestApp(env, { id: 999001 }), true);
    assert.equal((await whitelistStatus(env)).restricted, true);
  }
});

test('production admin whitelist status never reads stored development settings', async () => {
  const env = { APP_ENV: 'production', DB: { prepare() { assert.fail('No production whitelist reads.'); } } };
  assert.deepEqual(await whitelistStatus(env), { supported: false, enabled: false, restricted: false, ids: [], snapshotProtected: false, invalid: false });
  await assert.rejects(applyWhitelistChange(env, { action: 'set-enabled', enabled: true }, {}), /only in development/);
});

test('admin whitelist changes preserve seed IDs, de-duplicate and remove exact IDs', async () => {
  const { env } = fixture({ seed: '111002 111003' });
  const writes = [];
  const settings = { setAppSetting: (key, value) => writes.push([key, value]) };
  const added = await applyWhitelistChange(env, { action: 'add', ids: '111004, 111003' }, settings);
  assert.deepEqual(added.ids, ['111002', '111003', '111004']);
  assert.deepEqual(writes, [['test-whitelist', '["111002","111003","111004"]']]);
  const removed = await applyWhitelistChange(env, { action: 'remove', ids: '111002' }, settings);
  assert.deepEqual(removed.ids, ['111003']);
  assert.equal(removed.restricted, true);
  const emptied = await applyWhitelistChange(fixture({ seed: '111002' }).env, { action: 'remove', ids: '111002' }, settings);
  assert.equal(emptied.enabled, true);
  assert.equal(emptied.restricted, false);
});

test('switching access off retains tester IDs and validates boolean input', async () => {
  const { env } = fixture({ stored: { value: '["111002"]' } });
  const writes = [];
  const settings = { setAppSetting: (key, value) => writes.push([key, value]) };
  assert.deepEqual(await applyWhitelistChange(env, { action: 'set-enabled', enabled: false }, settings), { supported: true, enabled: false, restricted: false, ids: ['111002'], snapshotProtected: false, invalid: false });
  assert.deepEqual(writes, [['test-whitelist-enabled', 'false']]);
  await assert.rejects(applyWhitelistChange(env, { action: 'set-enabled', enabled: 'false' }, settings), /on or off/);
});

test('admin edits cannot turn off snapshot restrictions, even with an empty list', async () => {
  const { env } = fixture({ snapshot: { value: '' }, override: { value: 'false' } });
  const writes = [];
  const settings = { setAppSetting: (...value) => writes.push(value) };
  assert.deepEqual(await whitelistStatus(env), { supported: true, enabled: false, restricted: true, ids: [], snapshotProtected: true, invalid: false });
  await assert.rejects(applyWhitelistChange(env, { action: 'set-enabled', enabled: false }, settings), /copied production data/);
  assert.deepEqual(writes, []);
  const added = await applyWhitelistChange(env, { action: 'add', ids: '111002' }, settings);
  assert.equal(added.snapshotProtected, true);
  assert.equal(added.restricted, true);
  assert.deepEqual(added.ids, ['111002']);
});

test('admin can recover malformed policy explicitly without accepting invalid IDs', async () => {
  const { env } = fixture({ stored: { value: 'not-json' }, override: { value: 'not-json' } });
  const writes = [];
  const settings = { setAppSetting: (...value) => writes.push(value) };
  for (const ids of ['invalid', '0', '00111002', '1e5', '9007199254740992', '', ['111002'], 111002, '1 '.repeat(7000)]) await assert.rejects(applyWhitelistChange(env, { action: 'add', ids }, settings), /numeric Telegram user IDs/);
  await assert.rejects(applyWhitelistChange(env, { action: 'remove', ids: '111002' }, settings), /invalid/);
  const resetList = await applyWhitelistChange(env, { action: 'add', ids: '111002' }, settings);
  assert.deepEqual(resetList.ids, ['111002']);
  assert.equal(resetList.invalid, true); // The invalid switch still needs its own explicit reset.
  assert.equal(resetList.restricted, true);
  const resetSwitch = await applyWhitelistChange(env, { action: 'set-enabled', enabled: true }, settings);
  assert.equal(resetSwitch.enabled, true);
  assert.deepEqual(writes, [['test-whitelist', '["111002"]'], ['test-whitelist-enabled', 'true']]);
});

test('admin whitelist list size limits do not discard existing entries', async () => {
  const ids = Array.from({ length: 1000 }, (_, index) => String(111000 + index));
  const { env } = fixture({ stored: { value: JSON.stringify(ids) } });
  const settings = { setAppSetting() { assert.fail('Invalid updates must not write settings.'); } };
  await assert.rejects(applyWhitelistChange(env, { action: 'add', ids: '119999' }, settings), /at most 1000/);
  await assert.rejects(applyWhitelistChange(env, { action: 'add', ids: ids.slice(0, 101).join(' ') }, settings), /up to 100/);
  for (const input of [null, [], {}, { action: 'clear' }]) await assert.rejects(applyWhitelistChange(env, input, settings), /action/);
});

test('the legacy clear command repairs an invalid switch and retains valid switches', async () => {
  for (const [override, expected] of [['not-json', 'true'], ['false', 'false'], ['true', 'true']]) {
    const saved = new Map([['test-whitelist-enabled', override], ['test-whitelist', 'not-json']]);
    const replies = [];
    const env = { ...development, SUPER_ADMIN_ID: '999001', BOT_USERNAME: 'FictionalTesterBot', DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...input) { values = input; return this; },
          async first() {
            if (sql.startsWith('INSERT INTO lease')) return { owner: 'fictional-lease' };
            if (sql === "SELECT value FROM app_settings WHERE key='production-snapshot'") return null;
            const key = sql.match(/^SELECT value FROM app_settings WHERE key='([^']+)'$/)?.[1];
            if (key) return saved.has(key) ? { value: saved.get(key) } : null;
            if (sql === 'SELECT value FROM app_settings WHERE key=?' || sql === 'SELECT id FROM processed WHERE id=?') return null;
            assert.fail('Unexpected command fixture read.');
          },
          async all() {
            assert.equal(sql, "SELECT kind,id,data FROM records WHERE kind IN ('events','sessions','preferences')");
            return { results: [] };
          },
          async run() { assert.equal(sql, 'DELETE FROM lease WHERE owner=?'); },
          apply() {
            if (sql.startsWith('INSERT INTO app_settings')) saved.set(values[0], values[1]);
            else if (sql === 'INSERT INTO outbox(id,method,params) VALUES (?,?,?)') replies.push(JSON.parse(values[2]).text);
          }
        };
      },
      async batch(statements) { for (const statement of statements) statement.apply(); }
    } };
    const response = await handleWhitelistCommand(env, { update_id: 111001, message: { chat: { id: 999001, type: 'private' }, from: { id: 999001 }, text: '/whitelist clear' } });
    assert.equal(response.status, 200);
    assert.equal(saved.get('test-whitelist-enabled'), expected);
    assert.equal(saved.get('test-whitelist'), '[]');
    assert.match(replies[0], /Open to everyone/);
  }
});
