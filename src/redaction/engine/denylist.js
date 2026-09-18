// Layer 1 — custom known-value denylist (design §5.1). The heart of the tool:
// the only reliable way to redact unstructured identifiers like names.

import { AhoCorasick } from './ahocorasick.js';
import {
  normalizeText, normalizeNeedle, alnumStream, stripToAlnum,
  isWordChar, isDigitChar, isAlnumChar, crossesSectionBreak
} from './normalize.js';

// Classify a configured value into a matching strategy.
// - 'text'   → normalized (casefolded, whitespace-collapsed) matching with word boundaries
// - 'stream' → alphanumeric-stream matching (format-insensitive numbers/IDs)
export function classifyValue(entry) {
  const v = String(entry.value ?? '').trim();
  if (!v) return null;
  if (v.includes('@')) {
    return { mode: 'text', needles: [normalizeNeedle(v)] };
  }
  const stripped = stripToAlnum(v);
  if (/^[0-9]+$/.test(stripped) && stripped.length >= 4) {
    const needles = [stripped];
    // NANP convenience: a 10-digit number also matches with a leading 1, and vice versa.
    if (stripped.length === 10 && /[2-9]/.test(stripped[0])) needles.push('1' + stripped);
    if (stripped.length === 11 && stripped[0] === '1' && /[2-9]/.test(stripped[1])) needles.push(stripped.slice(1));
    return { mode: 'stream', needles, digitsOnly: true };
  }
  if (/^[0-9a-z]+$/.test(stripped) && /[0-9]/.test(stripped) && stripped.length >= 5 && !/\s/.test(v)) {
    return { mode: 'stream', needles: [stripped], digitsOnly: false };
  }
  const needle = normalizeNeedle(v);
  return needle ? { mode: 'text', needles: [needle] } : null;
}

// Match all configured values against the text in two single passes
// (one over normalized text, one over the alphanumeric stream).
// values: [{ id, label, value, tokenPrefix }]
// Returns candidate spans with original-text offsets.
export function matchKnownValues(text, values) {
  const textNeedles = []; // { needle, entry }
  const streamNeedles = []; // { needle, entry, digitsOnly }
  for (const entry of values || []) {
    const cls = classifyValue(entry);
    if (!cls) continue;
    for (const needle of cls.needles) {
      if (cls.mode === 'text') textNeedles.push({ needle, entry });
      else streamNeedles.push({ needle, entry, digitsOnly: cls.digitsOnly });
    }
  }
  const out = [];
  const seen = new Set();

  const emit = (start, end, entry) => {
    if (end <= start) return;
    if (crossesSectionBreak(text, start, end)) return;
    const key = `${start}:${end}:${entry.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      start, end,
      source: 'denylist',
      category: `value:${entry.id}`,
      label: entry.label || 'My value',
      prefix: entry.tokenPrefix || 'CUSTOM',
      confidence: 'high',
      valueId: entry.id
    });
  };

  if (textNeedles.length) {
    const { norm, map } = normalizeText(text);
    const ac = new AhoCorasick(textNeedles.map((t) => t.needle));
    for (const hit of ac.search(norm)) {
      const { needle, entry } = textNeedles[hit.needle];
      const a = hit.end - needle.length;
      const b = hit.end;
      // Word boundaries in normalized space so "Ann" ≠ "channel"/"planned"/"Anne".
      if (isWordChar(norm[a - 1]) || isWordChar(norm[b])) continue;
      emit(map[a].s, map[b - 1].e, entry);
    }
  }

  if (streamNeedles.length) {
    const { stream, map } = alnumStream(text);
    const ac = new AhoCorasick(streamNeedles.map((t) => t.needle));
    for (const hit of ac.search(stream)) {
      const { needle, entry, digitsOnly } = streamNeedles[hit.needle];
      const a = hit.end - needle.length;
      const b = hit.end;
      const start = map[a];
      const end = map[b - 1] + 1;
      // Boundary rules (design: account numbers should not be word-boundary
      // restricted, but must not match inside longer numbers):
      // digit needles reject digit neighbours; alphanumeric needles reject
      // alphanumeric neighbours.
      const prev = start > 0 ? text[start - 1] : null;
      const next = end < text.length ? text[end] : null;
      if (digitsOnly) {
        if (isDigitChar(prev) || isDigitChar(next)) continue;
      } else {
        if (isAlnumChar(prev) || isAlnumChar(next)) continue;
      }
      // Cosmetic: pull a leading "(" into the span when its closing paren is
      // part of the match — so "(416) 555-1234" redacts as a whole.
      let s2 = start;
      let e2 = end;
      if (text[s2 - 1] === '(') {
        if (text.slice(s2, e2).includes(')')) s2--;
        else if (text[e2] === ')') { s2--; e2++; }
      }
      emit(s2, e2, entry);
    }
  }

  return out;
}

// Values shorter than this (alphanumeric chars) over-redact even with boundaries.
export const SHORT_VALUE_THRESHOLD = 4;

export function isDangerouslyShort(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  return stripToAlnum(v).length > 0
    ? stripToAlnum(v).length < SHORT_VALUE_THRESHOLD
    : v.length < SHORT_VALUE_THRESHOLD;
}
