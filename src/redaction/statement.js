import { runDetection, finalizeSpans } from './engine/detect.js';
import { normalizeProfile } from './profile.js';
import { applyToText } from './engine/tokenize.js';

// Keep finance-specific policy separate from the upstream Local Redact engine.
export function detectStatementCandidates(text, savedProfile = {}, customValues = '', hooks = {}) {
  if (!hooks.findPhoneNumbers && globalThis.libphonenumber?.findPhoneNumbersInText) {
    hooks = { ...hooks, findPhoneNumbers: text => globalThis.libphonenumber.findPhoneNumbersInText(text, 'US')
      .map(f => ({ start: f.startsAt, end: f.endsAt })) };
  }
  const profile = normalizeProfile(savedProfile);
  const values = customValues.split(/\r?\n/).map(v => v.trim()).filter(Boolean)
    .map((value, id) => ({ id: 'session:' + id, value, label: 'Personal value', tokenPrefix: 'PRIVATE' }));
  const candidates = runDetection(text, {
    values: [...profile.values, ...values],
    patterns: profile.patterns
  }, hooks);
  // Account identifiers have no universal checksum. Only match labelled values;
  // arbitrary numbers could be transaction dates or amounts.
  const accounts = /\b(?:account|acct|card)(?:[ \t]+(?:number|no\.?))?[ \t]*[:#][ \t]*([\dXx*][\dXx* -]{3,}\d)\b/gi;
  for (const m of profile.patterns.account ? text.matchAll(accounts) : []) {
    const start = m.index + m[0].length - m[1].length;
    candidates.push({ start, end: start + m[1].length, category: 'account',
      label: 'Account number', prefix: 'ACCOUNT', source: 'pattern', confidence: 'high' });
  }
  return candidates;
}

export function reviewStatement(text, customValues = '', disabledKeys = new Set(), savedProfile = {}) {
  const candidates = detectStatementCandidates(text, savedProfile, customValues);
  const { spans } = finalizeSpans(text, candidates, { disabledKeys });
  return { spans, text: applyToText(text, spans) };
}

// Never include original rows, exception text, or warning strings in follow-ups:
// converters can interpolate arbitrary source text into all three.
export function safeValidationSummary(result) {
  if (!result) return 'No parse run yet.';
  if (result.error) return 'The parser failed. Check the spec syntax and required fields. Original error details remain local.';
  return `Parsed ${result.rows.length} transaction(s); ${result.errors.length} warning(s). Original rows and warning details remain local.`;
}

export function statementPrompt(format, reviewedText) {
  if (reviewedText == null) throw new Error('Review the statement sample before sharing.');
  return `Document type: ${String(format || '').toUpperCase()}\n\nDocument excerpt:\n---\n${reviewedText}\n---\n\nAnalyze this statement and produce a converter spec. Bracketed privacy tokens replace personal values; do not hard-code them into the spec.`;
}
