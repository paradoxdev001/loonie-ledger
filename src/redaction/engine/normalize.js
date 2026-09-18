// Normalization with offset mapping back to the original text.
// The user should not have to enter every format of a value; we normalize both
// the document and the configured values, then map matches back to original offsets.

// Characters treated as hard section boundaries (never collapsed, never matched across).
const SECTION_BREAK = '\f';

export function isWordChar(ch) {
  return ch != null && /[\p{L}\p{N}_]/u.test(ch);
}

export function isAlnumChar(ch) {
  return ch != null && /[A-Za-z0-9]/.test(ch);
}

export function isDigitChar(ch) {
  return ch != null && ch >= '0' && ch <= '9';
}

// Normalize document text for "text-like" value matching (names, addresses...).
// - casefold
// - straighten curly quotes
// - collapse every whitespace run (spaces, tabs, CR, LF) to a single space,
//   so values match across line wraps
// - keep '\f' as a hard boundary (page/part separator)
// Returns { norm, map } where map[i] = { s, e } original offsets covered by norm char i.
export function normalizeText(text) {
  const out = [];
  const map = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === SECTION_BREAK) {
      out.push(SECTION_BREAK);
      map.push({ s: i, e: i + 1 });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(text[j]) && text[j] !== SECTION_BREAK) j++;
      out.push(' ');
      map.push({ s: i, e: j });
      i = j;
      continue;
    }
    let c = ch.toLowerCase();
    if (c === '’' || c === '‘') c = "'";
    else if (c === '“' || c === '”') c = '"';
    // toLowerCase may expand to multiple code units for rare characters.
    for (let k = 0; k < c.length; k++) {
      out.push(c[k]);
      map.push({ s: i, e: i + 1 });
    }
    i++;
  }
  return { norm: out.join(''), map };
}

// Normalize a configured value the same way normalizeText normalizes the document.
export function normalizeNeedle(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

// Alphanumeric "stream" of the document: every [A-Za-z0-9] char, casefolded,
// with a map from stream index to original index. Used for number/ID matching
// so `416-555-1234`, `(416) 555 1234` and `4165551234` all match.
export function alnumStream(text) {
  let stream = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c >= '0' && c <= '9') {
      stream += c;
      map.push(i);
    } else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      stream += c.toLowerCase();
      map.push(i);
    }
  }
  return { stream, map };
}

export function stripToAlnum(value) {
  return String(value).replace(/[^0-9A-Za-z]+/g, '').toLowerCase();
}

// True if original span [start, end) crosses a hard section break.
export function crossesSectionBreak(text, start, end) {
  return text.slice(start, end).includes(SECTION_BREAK);
}
