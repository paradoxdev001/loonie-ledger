// End-to-end PDF redaction test against the real MuPDF WASM build —
// the same code path and engine the browser app uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from '../../src/redaction/vendor/mupdf/mupdf.js';
import { createPdfEngine, loadPdfForReview } from '../../src/redaction/pdf.js';
import { buildTestPdf, buildNoTextPdf } from './fixtures/minipdf.mjs';
import { runDetection, finalizeSpans } from '../../src/redaction/engine/detect.js';

const engine = createPdfEngine(mupdf);

const LINES = [
  'Account Statement for John Smith',
  'SIN: 046-454-286',
  'Card: 4111 1111 1111 1111',
  'Closing balance: 1,234.56'
];

function loadSession() {
  return engine.load(buildTestPdf(LINES));
}

test('extracts page text with per-char quads', () => {
  const session = loadSession();
  assert.equal(session.pages.length, 1);
  const { text, chars } = session.pages[0];
  assert.ok(text.includes('John Smith'));
  assert.ok(text.includes('046-454-286'));
  const visible = chars.filter((c) => c.quad);
  assert.ok(visible.length > 40);
  assert.ok(engine.hasTextLayer(session));
  engine.close(session);
});

test('true redaction removes text from the content stream', () => {
  const session = loadSession();
  const pageText = session.pages[0].text;

  const config = {
    values: [{ id: 'v1', label: 'Name', value: 'John Smith', tokenPrefix: 'NAME' }],
    patterns: { sin: true, card: true }
  };
  const { spans } = finalizeSpans(pageText, runDetection(pageText, config));
  assert.ok(spans.length >= 3, `expected >=3 spans, got ${spans.length}`);

  const boxes = [];
  for (const sp of spans) {
    for (const rect of engine.rectsForRange(session, 0, sp.start, sp.end)) {
      boxes.push({ rect, token: sp.token });
    }
  }
  const outBytes = engine.redactToBytes(session, [{ pageIndex: 0, boxes }]);
  engine.close(session);

  // Reopen the produced file and verify via extraction (the pdftotext test).
  const check = engine.load(outBytes);
  const outText = check.pages[0].text;
  const outDigits = outText.replace(/[^0-9]/g, '');

  assert.ok(!outText.includes('John Smith'), 'name must be gone');
  assert.ok(!outDigits.includes('046454286'), 'SIN digits must be gone');
  assert.ok(!outDigits.includes('4111111111111111'), 'card digits must be gone');
  assert.ok(outText.includes('Closing balance'), 'unrelated text must remain');
  assert.ok(outDigits.includes('123456'), 'balance amount must remain');

  // Consistent tokens drawn over the boxes should be extractable text.
  assert.ok(outText.includes('[NAME_1]'), 'token overlay baked into content');
  engine.close(check);
});

test('renders a page preview PNG', () => {
  const session = loadSession();
  const png = engine.renderPagePng(session, 0, 1.5);
  assert.ok(png.length > 1000);
  // PNG magic bytes
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  engine.close(session);
});

test('detects missing text layer (scanned-style PDF)', () => {
  const session = engine.load(buildNoTextPdf());
  assert.equal(engine.hasTextLayer(session), false);
  engine.close(session);
});


test('review accepts readable PDFs with blank and non-text pages and preserves them on export', () => {
  const doc = mupdf.Document.openDocument(buildTestPdf(LINES), 'application/pdf');
  const resources = doc.newDictionary();
  const blank = doc.addPage([0, 0, 612, 792], 0, resources, '');
  doc.insertPage(0, blank);
  const nonText = mupdf.Document.openDocument(buildNoTextPdf(), 'application/pdf');
  doc.graftPage(doc.countPages(), nonText, 0);
  const buffer = doc.saveToBuffer('garbage,compress');
  const bytes = buffer.asUint8Array().slice();
  buffer.destroy(); blank.destroy(); resources.destroy(); nonText.destroy(); doc.destroy();

  // This is the exact loader used by the document workspace.
  const session = loadPdfForReview(engine, bytes);
  assert.equal(session.pages.length, 3);
  assert.equal(session.pages[0].text.trim(), '');
  assert.ok(session.pages[1].text.includes('John Smith'));
  assert.equal(session.pages[2].text.trim(), '');
  const originalBlank = engine.renderPagePng(session, 0);
  const originalGraphic = engine.renderPagePng(session, 2);
  const start = session.pages[1].text.indexOf('John Smith');
  const boxes = engine.rectsForRange(session, 1, start, start + 'John Smith'.length)
    .map(rect => ({ rect, token: '[NAME_1]' }));
  const out = engine.redactToBytes(session, [{ pageIndex: 1, boxes }]);
  engine.close(session);
  const check = engine.load(out);
  assert.equal(check.pages.length, 3);
  assert.ok(!check.pages[1].text.includes('John Smith'));
  assert.ok(check.pages[1].text.includes('Closing balance'));
  assert.deepEqual(engine.renderPagePng(check, 0), originalBlank);
  assert.deepEqual(engine.renderPagePng(check, 2), originalGraphic);
  engine.close(check);
});

test('review still rejects PDFs with no readable text anywhere', () => {
  assert.throws(() => loadPdfForReview(engine, buildNoTextPdf()), /no readable text layer/);
});
