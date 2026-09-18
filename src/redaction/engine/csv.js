// CSV handling (design §7). The redacted file is produced by splicing tokens
// directly into the raw CSV text (format-preserving), so the parser tracks the
// raw offsets of every cell's content. Column-level redaction by header
// generates spans over each cell in that column.

import { sanitizePrefix } from './tokenize.js';

// RFC-4180-ish parser that records offsets into the raw text.
// Returns { rows: [{ cells: [{ start, end, contentStart, contentEnd, value }] }] }
// - [start, end)               raw extent of the cell including quotes
// - [contentStart, contentEnd) raw extent of the cell content (quotes excluded)
export function parseCsv(text) {
  const rows = [];
  let cells = [];
  const n = text.length;
  let i = 0;
  if (n === 0) return { rows };
  while (true) {
    const cellStart = i;
    let contentStart = i;
    let contentEnd = i;
    let value = '';
    if (text[i] === '"') {
      contentStart = i + 1;
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { value += '"'; j += 2; }
          else break;
        } else {
          value += text[j];
          j++;
        }
      }
      contentEnd = j;
      if (j < n) j++; // skip closing quote
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
      i = j;
    } else {
      let j = i;
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
      value = text.slice(i, j);
      contentStart = i;
      contentEnd = j;
      i = j;
    }
    cells.push({ start: cellStart, end: i, contentStart, contentEnd, value });
    if (i >= n) {
      rows.push({ cells });
      break;
    }
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
    else i++;
    rows.push({ cells });
    cells = [];
    if (i >= n) break;
  }
  return { rows };
}

export function csvHeaders(parsed) {
  if (!parsed.rows.length) return [];
  return parsed.rows[0].cells.map((c) => c.value.trim());
}

// Spans covering every non-empty cell of the named column (header row excluded).
export function columnSpansFor(parsed, headerName) {
  const headers = csvHeaders(parsed);
  const col = headers.findIndex((h) => h.toLowerCase() === String(headerName).trim().toLowerCase());
  if (col < 0) return [];
  const spans = [];
  for (let r = 1; r < parsed.rows.length; r++) {
    const cell = parsed.rows[r].cells[col];
    if (!cell) continue;
    if (cell.contentEnd <= cell.contentStart) continue;
    if (!cell.value.trim()) continue;
    spans.push({
      start: cell.contentStart,
      end: cell.contentEnd,
      source: 'column',
      category: `column:${headers[col].toLowerCase()}`,
      label: `Column: ${headers[col]}`,
      prefix: sanitizePrefix(headers[col]),
      confidence: 'high'
    });
  }
  return spans;
}
