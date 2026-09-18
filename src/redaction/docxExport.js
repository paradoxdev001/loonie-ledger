import { applyDocxEdits } from './engine/docx.js';

// Reset every supported XML part on every export. The original extracted
// offsets remain valid even after a previous download changed the zip entries.
export async function exportDocx(zip, parts, sections, spans) {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const section = sections.find(s => s.partIndex === i);
    const edits = spans.filter(s => s.enabled !== false && s.start >= section.start && s.end <= section.end)
      .map(s => ({ start: s.start - section.start, end: s.end - section.start, replacement: s.token || '[REDACTED]' }));
    zip.file(part.path, applyDocxEdits(part.xml, part.extract.charRanges, edits));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
