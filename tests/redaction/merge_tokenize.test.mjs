import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpans } from '../../src/redaction/engine/merge.js';
import { assignTokens, applyToText, sanitizePrefix } from '../../src/redaction/engine/tokenize.js';
import { runDetection, finalizeSpans } from '../../src/redaction/engine/detect.js';

test('denylist beats overlapping pattern span', () => {
  const text = 'SIN: 046-454-286';
  const config = {
    values: [{ id: 'v1', label: 'My SIN', value: '046454286', tokenPrefix: 'MYSIN' }],
    patterns: { sin: true }
  };
  const { spans } = finalizeSpans(text, runDetection(text, config));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].source, 'denylist');
  assert.equal(spans[0].token, '[MYSIN_1]');
});

test('longer match beats shorter at same priority', () => {
  const merged = mergeSpans([
    { start: 0, end: 4, category: 'zip_us', source: 'pattern', confidence: 'high' },
    { start: 0, end: 10, category: 'card', source: 'pattern', confidence: 'high' }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].category, 'card');
});

test('validated container absorbs denylist spans inside it (email vs names)', () => {
  const text = 'Contact: john.smith@example.com today';
  const config = {
    values: [
      { id: 'f', label: 'First name', value: 'John', tokenPrefix: 'NAME' },
      { id: 'l', label: 'Last name', value: 'Smith', tokenPrefix: 'NAME' }
    ],
    patterns: { email: true }
  };
  const { spans } = finalizeSpans(text, runDetection(text, config));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].category, 'email');
  assert.equal(text.slice(spans[0].start, spans[0].end), 'john.smith@example.com');
});

test('denylist still beats a same-length pattern span', () => {
  const text = 'SIN: 046-454-286';
  const config = {
    values: [{ id: 'v1', label: 'My SIN', value: '046454286', tokenPrefix: 'MYSIN' }],
    patterns: { sin: true }
  };
  const { spans } = finalizeSpans(text, runDetection(text, config));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].source, 'denylist');
});

test('manual spans always win', () => {
  const text = 'account 4111111111111111 end';
  const { spans } = finalizeSpans(text, runDetection(text, { patterns: {} }), {
    manualSpans: [{ start: 8, end: 24 }]
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].source, 'manual');
});

test('same value gets same token; distinct values increment', () => {
  const text = 'a@x.com wrote to b@x.com and again a@x.com';
  const spans = [
    { start: 0, end: 7, prefix: 'EMAIL', category: 'email' },
    { start: 17, end: 24, prefix: 'EMAIL', category: 'email' },
    { start: 35, end: 42, prefix: 'EMAIL', category: 'email' }
  ];
  assignTokens(spans, text);
  assert.equal(spans[0].token, '[EMAIL_1]');
  assert.equal(spans[1].token, '[EMAIL_2]');
  assert.equal(spans[2].token, '[EMAIL_1]');
});

test('same number in different formats gets one token', () => {
  const text = 'call 416-555-1234 or (416) 555-1234';
  const spans = [
    { start: 5, end: 17, prefix: 'PHONE', category: 'phone' },
    { start: 21, end: 35, prefix: 'PHONE', category: 'phone' }
  ];
  assignTokens(spans, text);
  assert.equal(spans[0].token, spans[1].token);
});

test('applyToText splices tokens and respects disabled spans', () => {
  const text = 'Hello John, meet John.';
  const spans = [
    { start: 6, end: 10, token: '[NAME_1]', enabled: true },
    { start: 18, end: 22, token: '[NAME_1]', enabled: false }
  ];
  assert.equal(applyToText(text, spans), 'Hello [NAME_1], meet John.');
});

test('disabledKeys mark spans disabled but keep them listed', () => {
  const text = 'mail a@x.com';
  const cands = runDetection(text, { patterns: { email: true } });
  const first = finalizeSpans(text, cands);
  const key = first.spans[0].key;
  const second = finalizeSpans(text, runDetection(text, { patterns: { email: true } }), {
    disabledKeys: new Set([key])
  });
  assert.equal(second.spans.length, 1);
  assert.equal(second.spans[0].enabled, false);
});

test('sanitizePrefix', () => {
  assert.equal(sanitizePrefix('account #'), 'ACCOUNT');
  assert.equal(sanitizePrefix('Child’s name'), 'CHILD_S_NAME');
  assert.equal(sanitizePrefix('   '), 'CUSTOM');
});
