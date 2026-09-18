import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/redaction/vendor/jszip.min.js';
import { exportDocx } from '../../src/redaction/docxExport.js';
import { extractDocxPart } from '../../src/redaction/engine/docx.js';

test('DOCX exports reflect current selections, including undo after an earlier export', async () => {
  const zip = new globalThis.JSZip();
  const xml = '<w:document><w:body><w:p><w:r><w:t>John Smith</w:t></w:r></w:p></w:body></w:document>';
  const parts = [{ path: 'word/document.xml', xml, extract: extractDocxPart(xml) }];
  const sections = [{ partIndex: 0, start: 0, end: parts[0].extract.text.length }];
  zip.file('word/document.xml', xml);
  zip.file('word/styles.xml', 'UNCHANGED STYLES');
  const first = await exportDocx(zip, parts, sections, [{ start: 0, end: 4, token: '[FIRST_NAME_1]' }]);
  const firstZip = await globalThis.JSZip.loadAsync(first);
  assert.ok((await firstZip.file('word/document.xml').async('string')).includes('[FIRST_NAME_1]'));
  const second = await exportDocx(zip, parts, sections, []);
  const secondZip = await globalThis.JSZip.loadAsync(second);
  assert.equal(await secondZip.file('word/document.xml').async('string'), xml);
  assert.equal(await secondZip.file('word/styles.xml').async('string'), 'UNCHANGED STYLES');
  assert.equal(parts[0].xml, xml);
});
