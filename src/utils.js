import { MONTH_ABBR } from './constants.js';

export function parseDate(input, format, yearHint) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (format === 'auto' || !format) {
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
    const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slash) {
      let [_, m, d, y] = slash;
      if (y.length === 2) y = '20' + y;
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return null;
  }

  const tokens = format.match(/YYYY|YY|MMM|MM|M|DD|D/g);
  if (!tokens) return null;
  const sep = format.replace(/YYYY|YY|MMM|MM|M|DD|D/g,'').match(/[\/\-\.\s]/);
  const sepChar = sep ? sep[0] : '';
  const splitRe = sepChar
    ? new RegExp(`[\\${sepChar}]|(?<=[A-Za-z])(?=\\d)|(?<=\\d)(?=[A-Za-z])`)
    : /(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/;
  const parts = s.split(splitRe).filter(Boolean);
  let y, m, d;
  tokens.forEach((tok, i) => {
    const v = parts[i];
    if (!v) return;
    if (tok === 'YYYY') y = v;
    else if (tok === 'YY') y = '20' + v;
    else if (tok === 'MMM') {
      m = MONTH_ABBR[v.toUpperCase().slice(0,3)] || null;
    }
    else if (tok === 'MM' || tok === 'M') m = v.padStart(2,'0');
    else if (tok === 'DD' || tok === 'D') d = v.padStart(2,'0');
  });
  if (!m || !d) return null;
  if (!y) y = yearHint ? String(yearHint) : String(new Date().getFullYear());
  const mi = parseInt(m, 10), di = parseInt(d, 10);
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  return `${y}-${m}-${d}`;
}

const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

export function formatDateDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const fmt = localStorage.getItem('loonieledger_date_format') || 'iso';
  if (fmt === 'friendly') {
    const month = FULL_MONTHS[parseInt(m, 10) - 1];
    const day = ordinal(parseInt(d, 10));
    return `${month} ${day}, ${y}`;
  }
  return `${y}-${m}-${d}`;
}

export function setDateFormat(fmt) {
  localStorage.setItem('loonieledger_date_format', fmt);
}

export function monthKey(iso) { return iso ? iso.slice(0,7) : ''; }
export function monthLabel(key) {
  if (!key) return '';
  const [y,m] = key.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m,10)-1]} ${y}`;
}

export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[\s$,]/g,'').replace(/[()]/g,m => m === '(' ? '-' : '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function formatMoney(n, currency='CAD') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
}

export function deriveSignedAmount(t) {
  if (typeof t.signed_amount === 'number') return t.signed_amount;
  const amt = Math.abs(t.amount || 0);
  const type = t.transaction_type;
  if (type === 'expense') return -amt;
  if (type === 'income' || type === 'refund' || type === 'cc_payment') return amt;
  if (type === 'transfer') {
    const d = (t.description || '').toLowerCase();
    if (/tfr-from|transfer from|^from\s/.test(d)) return amt;
    return -amt;
  }
  return -amt;
}

export async function fingerprint(parts) {
  const text = parts.filter(p => p !== null && p !== undefined).map(p => String(p).trim().toLowerCase()).join('|');
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).slice(0,12).map(b => b.toString(16).padStart(2,'0')).join('');
}

export function uid() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
export function classNames(...xs) { return xs.filter(Boolean).join(' '); }
export function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
export function downloadBlob(data, filename, mime='application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBatchSummary(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.autoImported) parts.push(`${stats.autoImported} imported`);
  if (stats.queuedForReview) parts.push(`${stats.queuedForReview} to review`);
  if (stats.skippedNoHint) parts.push(`${stats.skippedNoHint} unrecognized`);
  if (stats.errors) parts.push(`${stats.errors} failed`);
  return `Batch: ${parts.join(', ') || 'no files processed'}`;
}
