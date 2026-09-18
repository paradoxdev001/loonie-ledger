// Context boosting (design §5.3): raise a match's confidence when a relevant
// keyword appears nearby. Cheaply approximates an ML model; especially
// valuable for shape-only patterns.

const CONTEXT_KEYWORDS = {
  sin: ['sin', 'social insurance'],
  routing: ['routing', 'aba', 'transit', 'rtn'],
  ssn: ['ssn', 'social security'],
  card: ['card', 'visa', 'mastercard', 'amex', 'debit', 'credit'],
  phone: ['phone', 'tel', 'cell', 'mobile', 'fax', 'call'],
  zip_us: ['zip', 'postal', 'address'],
  postal_ca: ['postal', 'post code', 'address'],
  iban: ['iban', 'account'],
  ipv4: ['ip', 'address', 'host'],
  email: [],
  dob: []
};

export function applyContextBoost(text, spans, windowSize = 40) {
  for (const sp of spans) {
    if (sp.source !== 'pattern' || sp.boosted) continue;
    const kws = CONTEXT_KEYWORDS[sp.category];
    if (!kws || !kws.length) continue;
    const ctx = text.slice(Math.max(0, sp.start - windowSize), sp.start).toLowerCase();
    if (kws.some((k) => ctx.includes(k))) {
      sp.boosted = true;
      if (sp.confidence === 'tentative') sp.confidence = 'high';
    }
  }
  return spans;
}
