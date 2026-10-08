import test from 'node:test';
import assert from 'node:assert/strict';
import { accessPolicy, mayUseTestApp, whitelistEnabled } from '../src/test-access.js';

const development = { APP_ENV: 'development', TEST_WHITELIST_ENABLED: 'true' };

function fixture({ stored = null, seed = '', ...variables } = {}) {
  let reads = 0;
  const env = {
    ...development,
    WHITELIST_USER_IDS: seed,
    ...variables,
    DB: {
      prepare(sql) {
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
  const env = { ...development, TEST_WHITELIST_ENABLED: 'false', WHITELIST_USER_IDS: '111002' };
  assert.deepEqual(await accessPolicy(env), { enabled: false, ids: [], invalid: false });
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
