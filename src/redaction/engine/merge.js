// Confidence & span merging (design §6). A single piece of text must never
// carry two conflicting labels: denylist and validated identifiers beat loose
// patterns; longer matches beat shorter ones.

const CATEGORY_ORDER = ['card', 'iban', 'sin', 'routing', 'ssn', 'email', 'postal_ca', 'zip_us', 'ipv4', 'dob', 'phone'];

export function spanPriority(sp) {
  if (sp.source === 'manual') return 5;
  if (sp.source === 'column') return 4;
  if (sp.source === 'denylist') return 3;
  return sp.confidence === 'high' ? 2 : 1;
}

export function mergeSpans(candidates) {
  const spans = (candidates || []).filter((s) => s && s.end > s.start);
  const catRank = (s) => {
    const i = CATEGORY_ORDER.indexOf(s.category);
    return i < 0 ? 99 : i;
  };
  // Containment lift: a HIGH-confidence detected span that strictly contains a
  // denylist span absorbs it — choosing the longer span redacts strictly more
  // text (e.g. the email pattern wins over the user's first/last name matched
  // inside "john.smith@example.com", so "@example.com" doesn't survive).
  // Never lifts over manual or column spans — those are explicit user actions.
  const pri = new Map();
  for (const s of spans) pri.set(s, spanPriority(s));
  for (const x of spans) {
    if (x.confidence !== 'high' || x.source === 'manual') continue;
    for (const y of spans) {
      if (y === x || y.source !== 'denylist') continue;
      if (x.start <= y.start && x.end >= y.end && (x.end - x.start) > (y.end - y.start)) {
        pri.set(x, Math.max(pri.get(x), pri.get(y)));
      }
    }
  }
  const spanPri = (s) => pri.get(s);
  const sorted = [...spans].sort((a, b) =>
    spanPri(b) - spanPri(a) ||
    (b.boosted ? 1 : 0) - (a.boosted ? 1 : 0) ||
    (b.end - b.start) - (a.end - a.start) ||
    a.start - b.start ||
    catRank(a) - catRank(b)
  );
  const accepted = [];
  for (const s of sorted) {
    let overlaps = false;
    for (const a of accepted) {
      if (s.start < a.end && s.end > a.start) { overlaps = true; break; }
    }
    if (!overlaps) accepted.push(s);
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}
