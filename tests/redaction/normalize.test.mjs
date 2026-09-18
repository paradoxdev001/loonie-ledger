import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, normalizeNeedle, alnumStream, stripToAlnum } from '../../src/redaction/engine/normalize.js';

test('normalizeText casefolds and collapses whitespace with offset map', () => {
  const src = 'John\t  SMITH';
  const { norm, map } = normalizeText(src);
  assert.equal(norm, 'john smith');
  // 'j' maps to 0, the collapsed space covers the whole whitespace run
  assert.deepEqual(map[0], { s: 0, e: 1 });
  assert.deepEqual(map[4], { s: 4, e: 7 });
  // final char maps back to original last char
  assert.equal(map[norm.length - 1].e, src.length);
});

test('newlines collapse into a space (values match across line wraps)', () => {
  const { norm } = normalizeText('123 Main\nStreet');
  assert.equal(norm, '123 main street');
});

test('form feed is a hard boundary', () => {
  const { norm } = normalizeText('a\fb');
  assert.equal(norm, 'a\fb');
});

test('needle normalization matches document normalization', () => {
  assert.equal(normalizeNeedle('  John   SMITH '), 'john smith');
  assert.equal(normalizeNeedle('O’Brien'), "o'brien");
});

test('alnumStream maps stream indices to original indices', () => {
  const { stream, map } = alnumStream('(416) 555-1234');
  assert.equal(stream, '4165551234');
  assert.equal(map[0], 1); // '4' at index 1
  assert.equal(map[9], 13); // last '4'
});

test('stripToAlnum', () => {
  assert.equal(stripToAlnum('416-555-1234'), '4165551234');
  assert.equal(stripToAlnum('AB-12 34'), 'ab1234');
});
