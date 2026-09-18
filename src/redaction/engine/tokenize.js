// Consistent tokenization (design §9): replace each distinct entity with a
// stable token ([NAME_1], [NAME_2], [ADDRESS_1]) rather than a uniform
// "REDACTED", so relationships survive and an AI can still reason about the
// document. Also lays the groundwork for the v2 reversible vault.

export function sanitizePrefix(label) {
  const p = String(label || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return p ? p.slice(0, 16) : 'CUSTOM';
}

function canonicalize(surface) {
  const alnum = surface.replace(/[^0-9A-Za-z]+/g, '');
  if (/^\d+$/.test(alnum) && alnum.length >= 4) return 'd:' + alnum;
  return 't:' + surface.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Assigns sp.token to every span, mutating in place. Deterministic: numbering
// follows first appearance in the document. The same underlying value always
// receives the same token, in any surface format.
// Returns the tokenMap: token -> example surface value (basis for the v2
// reversible vault).
export function assignTokens(spans, text) {
  const counters = new Map();
  const keyToToken = new Map();
  const tokenMap = new Map();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (const sp of sorted) {
    const prefix = sp.prefix || 'REDACTED';
    const surface = text.slice(sp.start, sp.end);
    const key = sp.valueId != null
      ? `${prefix}|v:${sp.valueId}`
      : `${prefix}|${canonicalize(surface)}`;
    let token = keyToToken.get(key);
    if (!token) {
      const n = (counters.get(prefix) || 0) + 1;
      counters.set(prefix, n);
      token = `[${prefix}_${n}]`;
      keyToToken.set(key, token);
      tokenMap.set(token, surface);
    }
    sp.token = token;
  }
  return tokenMap;
}

// Produce redacted plain text by splicing tokens over enabled spans.
export function applyToText(text, spans) {
  const enabled = spans.filter((s) => s.enabled !== false).sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const sp of enabled) {
    if (sp.start < pos) continue;
    out += text.slice(pos, sp.start) + (sp.token || '[REDACTED]');
    pos = sp.end;
  }
  out += text.slice(pos);
  return out;
}
