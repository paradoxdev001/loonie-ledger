import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvHeaders, columnSpansFor } from '../../src/redaction/engine/csv.js';
import { assignTokens, applyToText } from '../../src/redaction/engine/tokenize.js';

test('parses simple csv with offsets', () => {
  const text = 'name,ssn\nJohn,078-05-1120\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(csvHeaders(parsed), ['name', 'ssn']);
  const cell = parsed.rows[1].cells[1];
  assert.equal(text.slice(cell.contentStart, cell.contentEnd), '078-05-1120');
});

test('parses quoted cells with embedded commas and escaped quotes', () => {
  const text = 'name,quote\n"Smith, John","He said ""hi"""\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.rows[1].cells[0].value, 'Smith, John');
  assert.equal(parsed.rows[1].cells[1].value, 'He said "hi"');
});

test('handles CRLF', () => {
  const text = 'a,b\r\n1,2\r\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].cells[1].value, '2');
});

test('column redaction produces spans over cell contents with consistent tokens', () => {
  const text = 'name,ssn\nJohn,078-05-1120\nJane,078-05-1120\nBob,529-99-1234\n';
  const parsed = parseCsv(text);
  const spans = columnSpansFor(parsed, 'SSN');
  assert.equal(spans.length, 3);
  spans.forEach((s, i) => { s.id = 'c' + i; s.enabled = true; });
  assignTokens(spans, text);
  const out = applyToText(text, spans);
  assert.equal(out, 'name,ssn\nJohn,[SSN_1]\nJane,[SSN_1]\nBob,[SSN_2]\n');
});

test('column redaction inside quoted cells preserves quotes', () => {
  const text = 'note,name\nx,"Smith, John"\n';
  const parsed = parseCsv(text);
  const spans = columnSpansFor(parsed, 'name');
  spans.forEach((s) => { s.enabled = true; });
  assignTokens(spans, text);
  assert.equal(applyToText(text, spans), 'note,name\nx,"[NAME_1]"\n');
});

test('unknown header yields no spans', () => {
  const parsed = parseCsv('a,b\n1,2\n');
  assert.deepEqual(columnSpansFor(parsed, 'nope'), []);
});
