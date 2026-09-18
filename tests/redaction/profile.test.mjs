import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, loadProfile, saveProfile, vaultStatus } from '../../src/redaction/profile.js';
import { reviewStatement } from '../../src/redaction/statement.js';

const profile = normalizeProfile({ values: [
  { id: 'p:firstName', label: 'First name', value: ' John ', tokenPrefix: 'FIRST_NAME' },
  { id: 'p:lastName', label: 'Last name', value: 'Smith', tokenPrefix: 'LAST_NAME' },
  { id: 'p:email', label: 'Email address', value: 'john.smith@example.com', tokenPrefix: 'EMAIL' },
  { id: 'c:account', label: 'Account number', value: '0031234567', tokenPrefix: 'ACCOUNT_NUMBER' }
] });

test('saved pairs automatically replace values using named tokens', () => {
  const text = 'JOHN Smith\njohn.smith@example.com\nAccount 003-1234567\nJohn Smith';
  const out = reviewStatement(text, '', new Set(), profile).text;
  assert.equal(out, '[FIRST_NAME_1] [LAST_NAME_1]\n[EMAIL_1]\nAccount [ACCOUNT_NUMBER_1]\n[FIRST_NAME_1] [LAST_NAME_1]');
});

test('saved detector preferences apply without disabling explicit personal values', () => {
  const off = Object.fromEntries(Object.keys(profile.patterns).map(k => [k, false]));
  const text = 'John Smith other@example.net john.smith@example.com';
  const out = reviewStatement(text, '', new Set(), { ...profile, patterns: off }).text;
  assert.ok(out.includes('other@example.net'));
  assert.ok(!out.includes('john.smith@example.com'));
  assert.ok(out.includes('[FIRST_NAME_1]'));
});

test('session values and saved IDs remain distinct and can be combined', () => {
  const out = reviewStatement('John Acme', 'Acme', new Set(), profile).text;
  assert.equal(out, '[FIRST_NAME_1] [PRIVATE_1]');
});

test('empty values are removed and custom labels produce safe token prefixes', () => {
  const clean = normalizeProfile({ values: [
    { id: 'empty', value: ' ' }, { id: 'custom', label: 'Case / ID', value: 'AB1234' }
  ] });
  assert.equal(clean.values.length, 1);
  assert.equal(clean.values[0].tokenPrefix, 'CASE_ID');
});

test('unsupported storage retains updated profiles in this session', async () => {
  // Node has WebCrypto but no IndexedDB. This exercises the explicit fallback.
  assert.equal(await saveProfile(profile), false);
  assert.equal(vaultStatus().persisted, false);
  assert.deepEqual(await loadProfile(), profile);
  await saveProfile({ values: [] });
  assert.deepEqual((await loadProfile()).values, []);
});
