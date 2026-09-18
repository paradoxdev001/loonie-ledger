import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewStatement, safeValidationSummary, statementPrompt } from '../../src/redaction/statement.js';

test('statement identifiers redact without changing transaction dates and amounts', () => {
  const source = 'Owner: Jordan Example\nAccount: 12345678\nEmail: jordan@example.com\nCard: 4111 1111 1111 1111\n2026-08-01,TEST GROCER,-25.50';
  const result = reviewStatement(source, 'Jordan Example');
  for (const value of ['Jordan Example', '12345678', 'jordan@example.com', '4111 1111 1111 1111']) assert.ok(!result.text.includes(value), value);
  assert.ok(result.text.includes('2026-08-01,TEST GROCER,-25.50'));
  assert.ok(source.includes('Jordan Example'));
});

test('duplicate personal values in PDF text and coordinate rows share tokens', () => {
  const result = reviewStatement('Jordan Example\ny=10 | x positions: 10, 40 | text: JORDAN EXAMPLE', 'Jordan Example');
  assert.equal((result.text.match(/\[PRIVATE_1\]/g) || []).length, 2);
  assert.ok(result.text.includes('x positions: 10, 40'));
});

test('reviewer can keep a detection and custom account values match separators', () => {
  const source = 'Account: 1234-5678\nhello@example.com';
  const first = reviewStatement(source, '12345678');
  const email = first.spans.find(s => s.category === 'email');
  const reviewed = reviewStatement(source, '12345678', new Set([email.key]));
  assert.ok(reviewed.text.includes('hello@example.com'));
  assert.ok(!reviewed.text.includes('1234-5678'));
});

test('automatic feedback cannot leak original descriptions or injected error strings', () => {
  const secret = 'PRIVATE ACCOUNT HOLDER 12345678';
  assert.ok(!safeValidationSummary({ error: secret }).includes(secret));
  const summary = safeValidationSummary({ rows: [{ description: secret }], errors: [{ row: secret, error: secret }] });
  assert.equal(summary, 'Parsed 1 transaction(s); 1 warning(s). Original rows and warning details remain local.');
});

test('sharing requires a reviewed sample and includes no filename metadata', () => {
  assert.throws(() => statementPrompt('csv', null), /Review/);
  const prompt = statementPrompt('csv', 'APPROVED SAMPLE');
  assert.ok(prompt.includes('APPROVED SAMPLE'));
  assert.ok(!prompt.includes('Filename:'));
});
