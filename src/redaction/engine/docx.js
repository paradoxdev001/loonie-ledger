// DOCX text extraction and in-place redaction (design §7).
// DOCX is a zip of XML; a single visible word can be split across multiple
// XML "runs", so we walk <w:t> nodes, stitch their text together, run
// detection on the stitched text, then map replacement spans back onto the
// raw XML. Pure string operations — no DOM — so it runs identically in the
// browser and in Node tests. Zip plumbing (JSZip) lives in the app layer.

// Parts of a .docx that can contain body text.
export const DOCX_TEXT_PART_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

const TOKEN_RE = /<w:t(?:\s[^>]*)?>|<\/w:p>|<w:br\s*\/?>|<w:cr\s*\/?>|<w:tab\s*\/?>/g;

const ENTITY_RE = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function decodeEntity(ent) {
  switch (ent) {
    case 'amp': return '&';
    case 'lt': return '<';
    case 'gt': return '>';
    case 'quot': return '"';
    case 'apos': return "'";
    default:
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        if (Number.isFinite(code)) {
          try { return String.fromCodePoint(code); } catch { return ''; }
        }
      }
      return '';
  }
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Extract readable text from one XML part.
// Returns { text, charRanges } where charRanges[i] is { s, e } — the raw XML
// range producing text[i] — or null for synthetic separators (paragraph
// breaks, tabs) that come from markup rather than character data.
export function extractDocxPart(xml) {
  const textOut = [];
  const charRanges = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml))) {
    const tag = m[0];
    if (tag.startsWith('<w:t')) {
      const contentStart = m.index + tag.length;
      const closeIdx = xml.indexOf('</w:t>', contentStart);
      if (closeIdx < 0) break; // malformed; stop rather than corrupt
      let i = contentStart;
      while (i < closeIdx) {
        const ch = xml[i];
        if (ch === '&') {
          const em = ENTITY_RE.exec(xml.slice(i, Math.min(closeIdx, i + 12)));
          if (em) {
            const decoded = decodeEntity(em[1]);
            for (let k = 0; k < decoded.length; k++) {
              textOut.push(decoded[k]);
              charRanges.push({ s: i, e: i + em[0].length });
            }
            i += em[0].length;
            continue;
          }
        }
        textOut.push(ch);
        charRanges.push({ s: i, e: i + 1 });
        i++;
      }
      TOKEN_RE.lastIndex = closeIdx + '</w:t>'.length;
    } else if (tag.startsWith('<w:tab')) {
      textOut.push('\t');
      charRanges.push(null);
    } else {
      // </w:p>, <w:br/>, <w:cr/>
      textOut.push('\n');
      charRanges.push(null);
    }
  }
  return { text: textOut.join(''), charRanges };
}

// Apply replacements to the raw XML of one part.
// edits: [{ start, end, replacement }] in extracted-text coordinates,
// non-overlapping. A span may cross multiple runs: the first covered raw run
// receives the (XML-escaped) replacement, subsequent covered runs are emptied.
// Synthetic separators inside the span are left untouched (they are markup).
export function applyDocxEdits(xml, charRanges, edits) {
  const rawEdits = [];
  for (const edit of edits) {
    const runs = [];
    let cur = null;
    for (let t = edit.start; t < edit.end; t++) {
      const r = charRanges[t];
      if (!r) { cur = null; continue; }
      if (cur && r.s === cur.e) {
        cur.e = r.e;
      } else {
        cur = { s: r.s, e: r.e };
        runs.push(cur);
      }
    }
    if (!runs.length) continue;
    rawEdits.push({ s: runs[0].s, e: runs[0].e, text: escapeXml(edit.replacement) });
    for (let k = 1; k < runs.length; k++) {
      rawEdits.push({ s: runs[k].s, e: runs[k].e, text: '' });
    }
  }
  rawEdits.sort((a, b) => b.s - a.s);
  let out = xml;
  for (const re of rawEdits) {
    out = out.slice(0, re.s) + re.text + out.slice(re.e);
  }
  return out;
}
