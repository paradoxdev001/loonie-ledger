import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocxPart, applyDocxEdits, DOCX_TEXT_PART_RE } from '../../src/redaction/engine/docx.js';
import { matchKnownValues } from '../../src/redaction/engine/denylist.js';

const XML =
  '<w:document><w:body>' +
  '<w:p><w:r><w:t>Dear Jo</w:t></w:r><w:r><w:t>hn Smith,</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Your SIN &amp; card are safe. A&lt;B.</w:t></w:r></w:p>' +
  '</w:body></w:document>';

test('extracts text stitched across runs with paragraph breaks and entities', () => {
  const { text } = extractDocxPart(XML);
  assert.equal(text, 'Dear John Smith,\nYour SIN & card are safe. A<B.\n');
});

test('replaces a value split across two runs', () => {
  const { text, charRanges } = extractDocxPart(XML);
  const spans = matchKnownValues(text, [{ id: '1', label: 'Name', value: 'John Smith', tokenPrefix: 'NAME' }]);
  assert.equal(spans.length, 1);
  const edited = applyDocxEdits(XML, charRanges, [
    { start: spans[0].start, end: spans[0].end, replacement: '[NAME_1]' }
  ]);
  const round = extractDocxPart(edited);
  assert.equal(round.text, 'Dear [NAME_1],\nYour SIN & card are safe. A<B.\n');
  // still well-formed enough to contain both original runs
  assert.ok(edited.includes('<w:t>Dear [NAME_1]</w:t>'));
  assert.ok(edited.includes('<w:t>,</w:t>'));
});

test('replacement spanning an entity keeps XML escaped', () => {
  const { text, charRanges } = extractDocxPart(XML);
  const target = 'SIN & card';
  const start = text.indexOf(target);
  const edited = applyDocxEdits(XML, charRanges, [
    { start, end: start + target.length, replacement: 'X<&>Y' }
  ]);
  const round = extractDocxPart(edited);
  assert.ok(round.text.includes('Your X<&>Y are safe.'));
  assert.ok(edited.includes('X&lt;&amp;&gt;Y'));
});

test('edits never touch synthetic separators', () => {
  const xml = '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>';
  const { text, charRanges } = extractDocxPart(xml);
  // span covering "one\ntwo" — crosses paragraph
  const edited = applyDocxEdits(xml, charRanges, [{ start: 0, end: 7, replacement: '[X_1]' }]);
  const round = extractDocxPart(edited);
  assert.equal(round.text, '[X_1]\n\n');
});

test('text part regex matches the right zip entries', () => {
  assert.ok(DOCX_TEXT_PART_RE.test('word/document.xml'));
  assert.ok(DOCX_TEXT_PART_RE.test('word/header1.xml'));
  assert.ok(DOCX_TEXT_PART_RE.test('word/footer2.xml'));
  assert.ok(!DOCX_TEXT_PART_RE.test('word/styles.xml'));
  assert.ok(!DOCX_TEXT_PART_RE.test('docProps/core.xml'));
});
