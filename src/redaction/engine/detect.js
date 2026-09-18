// Detection orchestrator: layers produce candidate spans, then merging +
// tokenization finalize what the review UI renders (design §4, §6).

import { matchKnownValues } from './denylist.js';
import { detectPatterns } from './patterns.js';
import { applyContextBoost } from './context.js';
import { mergeSpans } from './merge.js';
import { assignTokens } from './tokenize.js';

// Layer 1 + Layer 2. (Layer 3 ML/NER is a future hook: push its spans into the
// same candidate list with source: 'ner' and everything downstream just works.)
export function runDetection(text, config = {}, hooks = {}) {
  const candidates = [];
  candidates.push(...matchKnownValues(text, config.values || []));
  candidates.push(...detectPatterns(text, config.patterns || {}, hooks));
  applyContextBoost(text, candidates);
  return candidates;
}

// Merge candidates with user actions into the final span list.
// - manualSpans: user-added selections (always win)
// - columnSpans: CSV column-level redactions
// - disabledKeys: spans the user toggled off (kept, marked enabled: false)
export function finalizeSpans(text, candidates, { manualSpans = [], columnSpans = [], disabledKeys = new Set() } = {}) {
  const all = [
    ...candidates,
    ...columnSpans,
    ...manualSpans.map((m) => ({
      label: 'Manual',
      prefix: m.prefix || 'REDACTED',
      category: m.category || 'manual',
      ...m,
      source: 'manual',
      confidence: 'high'
    }))
  ];
  const merged = mergeSpans(all);
  let nextId = 1;
  for (const sp of merged) {
    sp.id = 's' + nextId++;
    sp.key = `${sp.start}:${sp.end}:${sp.category}`;
    sp.enabled = !disabledKeys.has(sp.key);
  }
  const tokenMap = assignTokens(merged, text);
  return { spans: merged, tokenMap };
}
