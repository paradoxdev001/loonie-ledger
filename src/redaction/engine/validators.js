// Checksum / plausibility validators. Design rule (§5.2):
// "validate, don't just shape-match" — a checksum turns a noisy pattern
// into a high-precision one.

export function luhnOk(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Returns issuer name for a card number (digits only) or null.
export function cardIssuer(d) {
  if (/^4\d{12}(?:\d{3})?(?:\d{3})?$/.test(d)) return 'Visa';
  if (/^(?:5[1-5]\d{14}|2(?:22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(d)) return 'Mastercard';
  if (/^3[47]\d{13}$/.test(d)) return 'Amex';
  if (/^(?:6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(d)) return 'Discover';
  if (/^35(?:2[89]|[3-8]\d)\d{12}$/.test(d)) return 'JCB';
  if (/^3(?:0[0-5]\d{11}|[68]\d{12})$/.test(d)) return 'Diners';
  return null;
}

// Canadian SIN: 9 digits, Luhn-validated.
export function sinOk(d) {
  return /^\d{9}$/.test(d) && luhnOk(d);
}

// US ABA routing number: 9 digits, weighted checksum + valid prefix range.
export function abaOk(d) {
  if (!/^\d{9}$/.test(d)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let s = 0;
  for (let i = 0; i < 9; i++) s += w[i] * (d.charCodeAt(i) - 48);
  if (s % 10 !== 0) return false;
  const p2 = Number(d.slice(0, 2));
  return p2 <= 12 || (p2 >= 21 && p2 <= 32) || (p2 >= 61 && p2 <= 72) || p2 === 80;
}

export const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24,
  FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21,
  HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24,
  SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29, VG: 24, XK: 20
};

// IBAN: country prefix + mod-97 checksum (design: "very reliable").
export function ibanOk(candidate) {
  const v = String(candidate).replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const cc = v.slice(0, 2);
  const expected = IBAN_LENGTHS[cc];
  if (expected) {
    if (v.length !== expected) return false;
  } else if (v.length < 15 || v.length > 34) {
    return false;
  }
  const rearranged = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const ch = rearranged[i];
    const piece = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (let k = 0; k < piece.length; k++) {
      rem = (rem * 10 + (piece.charCodeAt(k) - 48)) % 97;
    }
  }
  return rem === 1;
}

// US SSN plausibility: no checksum exists, but reject impossible values.
export function ssnPlausible(area, group, serial) {
  if (area === '000' || area === '666') return false;
  if (Number(area) >= 900) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

export function ipv4Ok(str) {
  const parts = String(str).split('.');
  if (parts.length !== 4) return false;
  return parts.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}
