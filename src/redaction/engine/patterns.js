// Layer 2 — pattern detection for structured identifiers only (design §4, §5.2).
// Patterns can only find structured data; names/addresses belong to Layer 1.

import { luhnOk, cardIssuer, sinOk, abaOk, ibanOk, ssnPlausible, ipv4Ok, IBAN_LENGTHS } from './validators.js';
import { isDigitChar, isAlnumChar, crossesSectionBreak } from './normalize.js';

export const CATEGORY_META = {
  card:      { label: 'Payment card',   prefix: 'CARD',    defaultOn: true,  group: 'Financial',    note: 'Luhn checksum + issuer prefix validated' },
  iban:      { label: 'IBAN',           prefix: 'IBAN',    defaultOn: true,  group: 'Financial',    note: 'mod-97 checksum validated' },
  routing:   { label: 'US routing (ABA)', prefix: 'ROUTING', defaultOn: true, group: 'Financial',   note: 'weighted checksum validated' },
  sin:       { label: 'Canadian SIN',   prefix: 'SIN',     defaultOn: true,  group: 'Government ID', note: 'Luhn checksum validated' },
  ssn:       { label: 'US SSN',         prefix: 'SSN',     defaultOn: true,  group: 'Government ID', note: 'strict format, impossible values rejected' },
  email:     { label: 'Email address',  prefix: 'EMAIL',   defaultOn: true,  group: 'Contact',       note: '' },
  postal_ca: { label: 'Canadian postal code', prefix: 'POSTAL', defaultOn: true, group: 'Location',  note: '' },
  zip_us:    { label: 'US ZIP code',    prefix: 'ZIP',     defaultOn: true,  group: 'Location',      note: 'bare 5-digit ZIPs are marked tentative' },
  ipv4:      { label: 'IP address',     prefix: 'IP',      defaultOn: true,  group: 'Technical',     note: '' },
  phone:     { label: 'Phone number',   prefix: 'PHONE',   defaultOn: false, group: 'Contact',       note: 'tentative — many long numbers look like phones' },
  dob:       { label: 'Date of birth',  prefix: 'DOB',     defaultOn: false, group: 'Government ID', note: 'only when anchored by “DOB:” / “Date of Birth:” — bare dates are never redacted' }
};

export function defaultPatternToggles() {
  const t = {};
  for (const [k, v] of Object.entries(CATEGORY_META)) t[k] = v.defaultOn;
  return t;
}

function makeSpan(text, start, end, category, confidence, extra = {}) {
  if (crossesSectionBreak(text, start, end)) return null;
  const meta = CATEGORY_META[category];
  return {
    start, end, category,
    label: meta.label,
    prefix: meta.prefix,
    confidence,
    source: 'pattern',
    ...extra
  };
}

function push(list, span) {
  if (span) list.push(span);
}

const isSepChar = (c) => c === ' ' || c === '-';

// --- Credit/debit cards: 13–19 digits, Luhn + issuer prefix (high precision) ---
function detectCards(text, out) {
  const runRe = /\d(?:[ -]?\d)*/g;
  let m;
  while ((m = runRe.exec(text))) {
    const base = m.index;
    const raw = m[0];
    const digitIdx = [];
    for (let k = 0; k < raw.length; k++) {
      if (isDigitChar(raw[k])) digitIdx.push(base + k);
    }
    if (digitIdx.length < 13) continue;
    const consumed = new Array(digitIdx.length).fill(false);
    for (let L = 19; L >= 13; L--) {
      for (let i = 0; i + L <= digitIdx.length; i++) {
        // Windows inside a run must start after / end before a separator,
        // so we don't pull a "card" out of the middle of a longer number.
        if (i > 0 && !isSepChar(text[digitIdx[i] - 1])) continue;
        if (i + L < digitIdx.length && !isSepChar(text[digitIdx[i + L - 1] + 1])) continue;
        let overlaps = false;
        for (let k = i; k < i + L; k++) {
          if (consumed[k]) { overlaps = true; break; }
        }
        if (overlaps) continue;
        let ds = '';
        for (let k = i; k < i + L; k++) ds += text[digitIdx[k]];
        if (!luhnOk(ds)) continue;
        const issuer = cardIssuer(ds);
        if (!issuer) continue;
        push(out, makeSpan(text, digitIdx[i], digitIdx[i + L - 1] + 1, 'card', 'high', { validated: true, detail: issuer }));
        for (let k = i; k < i + L; k++) consumed[k] = true;
      }
    }
  }
}

// --- Canadian SIN: 9 digits (optionally 3-3-3 grouped), Luhn ---
function detectSin(text, out) {
  const re = /\d{3}[ -]?\d{3}[ -]?\d{3}/g;
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isDigitChar(text[s - 1]) || isDigitChar(text[e])) continue;
    const d = m[0].replace(/[ -]/g, '');
    if (d.length !== 9 || !sinOk(d)) continue;
    push(out, makeSpan(text, s, e, 'sin', 'high', { validated: true }));
  }
}

// --- US ABA routing: 9 contiguous digits, weighted checksum ---
function detectRouting(text, out) {
  const re = /\d{9}/g;
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isDigitChar(text[s - 1]) || isDigitChar(text[e])) continue;
    if (!abaOk(m[0])) continue;
    push(out, makeSpan(text, s, e, 'routing', 'high', { validated: true }));
  }
}

// --- US SSN: dashed 3-2-4 always; bare 9 digits only with nearby context ---
const SSN_CONTEXT = /\b(?:ssn|social\s+security)\b/i;
function detectSsn(text, out) {
  const dashed = /\d{3}-\d{2}-\d{4}/g;
  let m;
  while ((m = dashed.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isDigitChar(text[s - 1]) || isDigitChar(text[e])) continue;
    if (text[s - 1] === '-' || text[e] === '-') continue;
    const [area, group, serial] = m[0].split('-');
    if (!ssnPlausible(area, group, serial)) continue;
    push(out, makeSpan(text, s, e, 'ssn', 'high', { validated: true }));
  }
  const bare = /\d{9}/g;
  while ((m = bare.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isDigitChar(text[s - 1]) || isDigitChar(text[e])) continue;
    const before = text.slice(Math.max(0, s - 32), s);
    if (!SSN_CONTEXT.test(before)) continue;
    const d = m[0];
    if (!ssnPlausible(d.slice(0, 3), d.slice(3, 5), d.slice(5))) continue;
    push(out, makeSpan(text, s, e, 'ssn', 'high', { validated: true, boosted: true }));
  }
}

// --- Email: pragmatic something@something.tld (design: do NOT attempt full RFC) ---
function detectEmail(text, out) {
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
  let m;
  while ((m = re.exec(text))) {
    let s = m.index;
    let e = s + m[0].length;
    while (text[e - 1] === '.') e--; // trailing sentence period
    if (isAlnumChar(text[s - 1])) continue;
    push(out, makeSpan(text, s, e, 'email', 'high'));
  }
}

// --- IBAN: CCnn anchor, collect grouped run, exact country length, mod-97 ---
function detectIban(text, out) {
  const anchor = /[A-Za-z]{2}\d{2}/g;
  let m;
  while ((m = anchor.exec(text))) {
    const s = m.index;
    if (isAlnumChar(text[s - 1])) continue;
    // Collect a run of alphanumerics allowing single spaces/dashes between groups.
    const chars = [];
    let i = s;
    while (i < text.length) {
      const c = text[i];
      if (isAlnumChar(c)) {
        chars.push(i);
        i++;
      } else if ((c === ' ' || c === '-') && chars.length && isAlnumChar(text[i + 1])) {
        i++;
      } else {
        break;
      }
    }
    if (chars.length < 15) continue;
    const cc = (text[chars[0]] + text[chars[1]]).toUpperCase();
    const tryLens = [];
    if (IBAN_LENGTHS[cc]) {
      tryLens.push(IBAN_LENGTHS[cc]);
    } else {
      for (let L = Math.min(34, chars.length); L >= 15; L--) tryLens.push(L);
    }
    for (const L of tryLens) {
      if (chars.length < L) continue;
      let val = '';
      for (let k = 0; k < L; k++) val += text[chars[k]];
      if (ibanOk(val)) {
        const end = chars[L - 1] + 1;
        push(out, makeSpan(text, s, end, 'iban', 'high', { validated: true }));
        anchor.lastIndex = end;
        break;
      }
    }
  }
}

// --- Canadian postal code: strict letter/digit alternation, invalid letters excluded ---
const CA_FIRST = 'ABCEGHJKLMNPRSTVXY';
const CA_REST = 'ABCEGHJKLMNPRSTVWXYZ';
function detectPostalCa(text, out) {
  const re = new RegExp(`[${CA_FIRST}]\\d[${CA_REST}][ -]?\\d[${CA_REST}]\\d`, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isAlnumChar(text[s - 1]) || isAlnumChar(text[e])) continue;
    push(out, makeSpan(text, s, e, 'postal_ca', 'high'));
  }
}

// --- US ZIP: 12345 or 12345-6789. ZIP+4 high; bare 5 digits tentative ---
function detectZip(text, out) {
  const re = /\d{5}(?:-\d{4})?/g;
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isAlnumChar(text[s - 1]) || isAlnumChar(text[e])) continue;
    if (text[s - 1] === '-' || text[e] === '-') continue; // part of a longer dashed number
    const plus4 = m[0].length > 5;
    push(out, makeSpan(text, s, e, 'zip_us', plus4 ? 'high' : 'tentative'));
  }
}

// --- IPv4: validate octets 0–255. All-small octets (1.2.3.4) look like versions → tentative ---
function detectIpv4(text, out) {
  const re = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g;
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isAlnumChar(text[s - 1]) || isAlnumChar(text[e])) continue;
    if (text[s - 1] === '.' || text[e] === '.') continue;
    if (!ipv4Ok(m[0])) continue;
    const versionish = m[0].split('.').every((o) => Number(o) < 10);
    push(out, makeSpan(text, s, e, 'ipv4', versionish ? 'tentative' : 'high'));
  }
}

// --- Phone: use libphonenumber via hook (design: do NOT hand-roll). Tentative. ---
function detectPhones(text, out, hooks) {
  if (typeof hooks.findPhoneNumbers === 'function') {
    let found = [];
    try {
      found = hooks.findPhoneNumbers(text) || [];
    } catch {
      found = [];
    }
    for (const f of found) {
      push(out, makeSpan(text, f.start, f.end, 'phone', 'tentative'));
    }
    return;
  }
  // Fallback only when libphonenumber is unavailable: conservative NANP shape.
  const re = /\(?[2-9]\d{2}\)?[ -.]\d{3}[ -.]\d{4}/g;
  let m;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (isDigitChar(text[s - 1]) || isDigitChar(text[e])) continue;
    push(out, makeSpan(text, s, e, 'phone', 'tentative'));
  }
}

// --- DOB: ONLY when contextually anchored. Bare dates are never redacted. ---
const DOB_RE = new RegExp(
  String.raw`\b(?:date\s+of\s+birth|birth\s*date|dob|born(?:\s+on)?)\b[:\s]*` +
  String.raw`(` +
  String.raw`\d{4}-\d{2}-\d{2}` +
  String.raw`|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}` +
  String.raw`|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}` +
  String.raw`|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4}` +
  String.raw`)`,
  'gi'
);
function detectDob(text, out) {
  let m;
  DOB_RE.lastIndex = 0;
  while ((m = DOB_RE.exec(text))) {
    const date = m[1];
    const s = m.index + m[0].length - date.length; // date group is always the suffix
    push(out, makeSpan(text, s, s + date.length, 'dob', 'high', { boosted: true }));
  }
}

// Run all enabled pattern detectors.
// toggles: { card: true, ... } — anything missing falls back to its default.
// hooks: { findPhoneNumbers?: (text) => [{start, end}] }
export function detectPatterns(text, toggles = {}, hooks = {}) {
  const on = (k) => (k in toggles ? !!toggles[k] : CATEGORY_META[k].defaultOn);
  const out = [];
  if (on('card')) detectCards(text, out);
  if (on('iban')) detectIban(text, out);
  if (on('sin')) detectSin(text, out);
  if (on('routing')) detectRouting(text, out);
  if (on('ssn')) detectSsn(text, out);
  if (on('email')) detectEmail(text, out);
  if (on('postal_ca')) detectPostalCa(text, out);
  if (on('zip_us')) detectZip(text, out);
  if (on('ipv4')) detectIpv4(text, out);
  if (on('phone')) detectPhones(text, out, hooks);
  if (on('dob')) detectDob(text, out);
  return out;
}
