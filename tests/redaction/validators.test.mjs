import test from 'node:test';
import assert from 'node:assert/strict';
import { luhnOk, cardIssuer, sinOk, abaOk, ibanOk, ssnPlausible, ipv4Ok } from '../../src/redaction/engine/validators.js';

test('luhn accepts valid card numbers', () => {
  assert.ok(luhnOk('4111111111111111'));
  assert.ok(luhnOk('5500005555555559'));
  assert.ok(luhnOk('378282246310005'));
});

test('luhn rejects invalid numbers', () => {
  assert.ok(!luhnOk('4111111111111112'));
  assert.ok(!luhnOk('1234567890123456'));
});

test('card issuer prefixes', () => {
  assert.equal(cardIssuer('4111111111111111'), 'Visa');
  assert.equal(cardIssuer('5555555555554444'), 'Mastercard');
  assert.equal(cardIssuer('2221000000000009'), 'Mastercard');
  assert.equal(cardIssuer('378282246310005'), 'Amex');
  assert.equal(cardIssuer('6011111111111117'), 'Discover');
  assert.equal(cardIssuer('9999999999999995'), null);
});

test('canadian SIN luhn validation', () => {
  assert.ok(sinOk('046454286')); // canonical CRA test SIN
  assert.ok(!sinOk('123456789'));
  assert.ok(!sinOk('04645428'));
});

test('ABA routing checksum + prefix', () => {
  assert.ok(abaOk('021000021')); // JPMorgan Chase
  assert.ok(abaOk('011401533'));
  assert.ok(!abaOk('021000022'));
  assert.ok(!abaOk('991000021')); // bad prefix range even if checksum contrived
});

test('IBAN mod-97 with country lengths', () => {
  assert.ok(ibanOk('DE89370400440532013000'));
  assert.ok(ibanOk('GB82WEST12345698765432'));
  assert.ok(ibanOk('DE89 3704 0044 0532 0130 00'));
  assert.ok(!ibanOk('DE89370400440532013001'));
  assert.ok(!ibanOk('DE8937040044053201300')); // wrong length for DE
});

test('SSN plausibility rejects impossible values', () => {
  assert.ok(ssnPlausible('078', '05', '1120'));
  assert.ok(!ssnPlausible('000', '05', '1120'));
  assert.ok(!ssnPlausible('666', '05', '1120'));
  assert.ok(!ssnPlausible('900', '05', '1120'));
  assert.ok(!ssnPlausible('078', '00', '1120'));
  assert.ok(!ssnPlausible('078', '05', '0000'));
});

test('ipv4 octet validation', () => {
  assert.ok(ipv4Ok('10.0.0.1'));
  assert.ok(ipv4Ok('255.255.255.255'));
  assert.ok(!ipv4Ok('192.168.1.300'));
  assert.ok(!ipv4Ok('1.2.3'));
});
