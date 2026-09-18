import test from 'node:test';
import assert from 'node:assert/strict';
import { matchKnownValues, classifyValue, isDangerouslyShort } from '../../src/redaction/engine/denylist.js';
import { mergeSpans } from '../../src/redaction/engine/merge.js';

const val = (id, label, value, tokenPrefix = 'CUSTOM') => ({ id, label, value, tokenPrefix });

// Overlapping candidates (e.g. a number and its +1 variant) are resolved by
// mergeSpans in the real pipeline, so tests assert on merged output.
function surfaces(text, values) {
  return mergeSpans(matchKnownValues(text, values)).map((s) => text.slice(s.start, s.end));
}

test('name matches case-insensitively with word boundaries', () => {
  const text = 'Dear ANN, the channel is planned. Anne is not you, Ann.';
  const spans = surfaces(text, [val('1', 'First name', 'Ann', 'NAME')]);
  assert.deepEqual(spans, ['ANN', 'Ann']);
});

test('multi-word value matches across whitespace and line wraps', () => {
  const text = 'Bill to:\nJohn\n  SMITH\nToronto';
  const spans = surfaces(text, [val('1', 'Name', 'John Smith', 'NAME')]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0], 'John\n  SMITH');
});

test('phone number matches in any format from one configured value', () => {
  const values = [val('p', 'Phone', '416-555-1234', 'PHONE')];
  assert.deepEqual(surfaces('Call (416) 555-1234 now', values), ['(416) 555-1234']);
  assert.deepEqual(surfaces('Call 4165551234 now', values), ['4165551234']);
  assert.deepEqual(surfaces('Call +1 416 555 1234 now', values), ['1 416 555 1234']);
});

test('digit values do not match inside longer numbers', () => {
  const values = [val('a', 'Account', '12345678', 'ACCOUNT')];
  assert.deepEqual(surfaces('ref 99912345678999', values), []);
  assert.deepEqual(surfaces('acct 1234-5678 ok', values), ['1234-5678']);
  // not word-boundary restricted: letters right next to the number still match
  assert.deepEqual(surfaces('ACCT12345678', values), ['12345678']);
});

test('email values match exactly, case-insensitive', () => {
  const values = [val('e', 'Email', 'John.Smith@Example.com', 'EMAIL')];
  assert.deepEqual(surfaces('mail john.smith@example.com today', values), ['john.smith@example.com']);
  assert.deepEqual(surfaces('bjohn.smith@example.com', values), []);
});

test('classification of value kinds', () => {
  assert.equal(classifyValue({ value: 'John Smith' }).mode, 'text');
  assert.equal(classifyValue({ value: '416-555-1234' }).mode, 'stream');
  assert.equal(classifyValue({ value: 'CASE-2024-0042' }).mode, 'stream');
  assert.equal(classifyValue({ value: 'j@x.io' }).mode, 'text');
  assert.equal(classifyValue({ value: '   ' }), null);
});

test('short value guard', () => {
  assert.ok(isDangerouslyShort('Al'));
  assert.ok(isDangerouslyShort('12'));
  assert.ok(!isDangerouslyShort('Anna'));
  assert.ok(!isDangerouslyShort(''));
});
