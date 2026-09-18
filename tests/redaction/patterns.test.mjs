import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, defaultPatternToggles } from '../../src/redaction/engine/patterns.js';
import { applyContextBoost } from '../../src/redaction/engine/context.js';

function find(text, toggles = {}, hooks = {}) {
  return detectPatterns(text, { ...defaultPatternToggles(), ...toggles }, hooks);
}
const byCat = (spans, cat) => spans.filter((s) => s.category === cat);
const surface = (text, s) => text.slice(s.start, s.end);

test('detects valid card numbers in grouped and plain formats', () => {
  const t1 = 'Card: 4111 1111 1111 1111 exp 12/28';
  const c1 = byCat(find(t1), 'card');
  assert.equal(c1.length, 1);
  assert.equal(surface(t1, c1[0]), '4111 1111 1111 1111');

  const t2 = 'card 378282246310005.';
  const c2 = byCat(find(t2), 'card');
  assert.equal(c2.length, 1);
  assert.equal(surface(t2, c2[0]), '378282246310005');
});

test('rejects luhn-invalid card-shaped numbers (order numbers)', () => {
  const t = 'Order 4111 1111 1111 1112 shipped';
  assert.equal(byCat(find(t), 'card').length, 0);
});

test('detects SIN with luhn, rejects invalid', () => {
  const t = 'SIN: 046-454-286 and ref 123-456-789';
  const sins = byCat(find(t), 'sin');
  assert.equal(sins.length, 1);
  assert.equal(surface(t, sins[0]), '046-454-286');
});

test('detects ABA routing number', () => {
  const t = 'Routing: 021000021 Account: 12345';
  const r = byCat(find(t), 'routing');
  assert.equal(r.length, 1);
  assert.equal(surface(t, r[0]), '021000021');
});

test('detects dashed SSN, rejects impossible SSNs', () => {
  const t = 'SSN 078-05-1120, bogus 666-12-3456 and 900-11-2222';
  const s = byCat(find(t), 'ssn');
  assert.equal(s.length, 1);
  assert.equal(surface(t, s[0]), '078-05-1120');
});

test('bare 9-digit SSN only with context anchor', () => {
  const withCtx = byCat(find('Social Security number: 078051120'), 'ssn');
  assert.equal(withCtx.length, 1);
  const noCtx = byCat(find('Reference: 078051120'), 'ssn');
  assert.equal(noCtx.length, 0);
});

test('detects email, trims trailing period', () => {
  const t = 'Write to jane.doe+tax@example.co.uk.';
  const e = byCat(find(t), 'email');
  assert.equal(e.length, 1);
  assert.equal(surface(t, e[0]), 'jane.doe+tax@example.co.uk');
});

test('detects IBAN in grouped format without swallowing following words', () => {
  const t = 'IBAN DE89 3704 0044 0532 0130 00 Balance 1,000';
  const i = byCat(find(t), 'iban');
  assert.equal(i.length, 1);
  assert.equal(surface(t, i[0]), 'DE89 3704 0044 0532 0130 00');
});

test('canadian postal code letter rules', () => {
  const ok = byCat(find('Toronto ON M5V 3L9'), 'postal_ca');
  assert.equal(ok.length, 1);
  const bad = byCat(find('code D1A 1A1 here'), 'postal_ca');
  assert.equal(bad.length, 0);
});

test('ZIP+4 high, bare ZIP5 tentative', () => {
  const t = 'Mail to 90210 or 10118-0110';
  const z = byCat(find(t), 'zip_us');
  assert.equal(z.length, 2);
  const five = z.find((s) => surface(t, s) === '90210');
  const nine = z.find((s) => surface(t, s) === '10118-0110');
  assert.equal(five.confidence, 'tentative');
  assert.equal(nine.confidence, 'high');
});

test('ipv4 validated; version-like strings tentative', () => {
  const t = 'host 192.168.1.42 running version 1.2.3.4 but not 192.168.1.300';
  const ips = byCat(find(t), 'ipv4');
  assert.equal(ips.length, 2);
  assert.equal(ips.find((s) => surface(t, s) === '192.168.1.42').confidence, 'high');
  assert.equal(ips.find((s) => surface(t, s) === '1.2.3.4').confidence, 'tentative');
});

test('phones off by default; hook used when enabled', () => {
  const t = 'Call 416-967-1111 today';
  assert.equal(byCat(find(t), 'phone').length, 0);
  const spans = byCat(
    find(t, { phone: true }, { findPhoneNumbers: () => [{ start: 5, end: 17 }] }),
    'phone'
  );
  assert.equal(spans.length, 1);
  assert.equal(spans[0].confidence, 'tentative');
});

test('DOB only when anchored; bare dates never redacted', () => {
  const t1 = 'Date of Birth: 03/14/1985';
  const d1 = byCat(find(t1, { dob: true }), 'dob');
  assert.equal(d1.length, 1);
  assert.equal(surface(t1, d1[0]), '03/14/1985');

  const t2 = 'Payment due 03/14/2026 and posted 2026-01-02';
  assert.equal(byCat(find(t2, { dob: true }), 'dob').length, 0);

  const t3 = 'DOB: March 14, 1985';
  const d3 = byCat(find(t3, { dob: true }), 'dob');
  assert.equal(d3.length, 1);
  assert.equal(surface(t3, d3[0]), 'March 14, 1985');
});

test('context boost raises tentative to high', () => {
  const t = 'Phone: 416-967-1111';
  const spans = find(t, { phone: true }, { findPhoneNumbers: () => [{ start: 7, end: 19 }] });
  applyContextBoost(t, spans);
  const p = byCat(spans, 'phone')[0];
  assert.equal(p.confidence, 'high');
  assert.ok(p.boosted);
});

test('toggles disable detectors', () => {
  const t = 'Card: 4111 1111 1111 1111';
  assert.equal(byCat(find(t, { card: false }), 'card').length, 0);
});
