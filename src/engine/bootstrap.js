import { parseDate, parseAmount, getCurrency } from '../utils.js';
import { pdfToText } from './converter.js';

const Papa = window.Papa;

export function suggestCSVSpec(text) {
  const delimiters = [',',';','\t','|'];
  let best = null;
  for (const d of delimiters) {
    const p = Papa.parse(text.slice(0, 10000), { delimiter: d, skipEmptyLines: true });
    if (!p.data.length) continue;
    const counts = p.data.slice(0, 30).map(r => r.length);
    const max = Math.max(...counts);
    const consistency = counts.filter(c => c === max).length / counts.length;
    if (max >= 3 && consistency > 0.6 && (!best || max * consistency > best.score)) {
      best = { delimiter: d, score: max * consistency, data: p.data, max };
    }
  }
  if (!best) return null;

  const { delimiter, data } = best;
  const first = data[0];
  const looksLikeHeader = first.every(c => c && !/^-?\$?\d/.test(String(c).trim()));
  const has_header = looksLikeHeader;
  const headers = has_header ? first.map(h => String(h).trim()) : null;
  const sample = has_header ? data.slice(1, 6) : data.slice(0, 5);

  const out = {
    type: 'csv',
    has_header,
    delimiter,
    columns: {},
    date_format: 'auto',
    amount_handling: 'single_signed',
    amount_sign: 'natural',
    account_type: 'chequing',
    default_account: '',
    default_currency: getCurrency()
  };

  const numCols = sample[0]?.length || 0;
  const colStats = [];
  for (let i = 0; i < numCols; i++) {
    const vals = sample.map(r => r[i] || '');
    const numeric = vals.filter(v => !isNaN(parseAmount(v)) && parseAmount(v) !== null).length;
    const date = vals.filter(v => parseDate(v, 'auto')).length;
    const textLen = vals.reduce((a,v) => a + String(v).length, 0) / Math.max(vals.length,1);
    colStats.push({ i, numeric, date, textLen, header: headers?.[i] || `Column ${i+1}` });
  }

  const dateCol = colStats.filter(c => c.date >= sample.length / 2).sort((a,b) => b.date - a.date || a.i - b.i)[0];
  if (dateCol) out.columns.transaction_date = headers ? headers[dateCol.i] : dateCol.i;

  const descCol = colStats
    .filter(c => c !== dateCol && c.numeric < sample.length / 2)
    .sort((a,b) => b.textLen - a.textLen)[0];
  if (descCol) out.columns.description = headers ? headers[descCol.i] : descCol.i;

  const amountCols = colStats.filter(c => c !== dateCol && c.numeric >= sample.length / 2);
  if (amountCols.length >= 2 && headers) {
    const debitName = headers.find(h => /debit|withdrawal|out|paid/i.test(h));
    const creditName = headers.find(h => /credit|deposit|in|received/i.test(h));
    if (debitName && creditName) {
      out.amount_handling = 'split_debit_credit';
      out.columns.debit = debitName;
      out.columns.credit = creditName;
    } else {
      out.columns.amount = headers ? headers[amountCols[0].i] : amountCols[0].i;
    }
  } else if (amountCols.length === 1) {
    out.columns.amount = headers ? headers[amountCols[0].i] : amountCols[0].i;
  } else if (amountCols.length === 2 && !headers) {
    out.amount_handling = 'split_debit_credit';
    out.columns.debit = amountCols[0].i;
    out.columns.credit = amountCols[1].i;
  }

  if (dateCol) {
    const v = String(sample.find(r => r[dateCol.i])?.[dateCol.i] || '').trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) out.date_format = 'YYYY-MM-DD';
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) out.date_format = 'MM/DD/YYYY';
    else if (/^\d{1,2}\/\d{1,2}\/\d{2}\b/.test(v)) out.date_format = 'MM/DD/YY';
    else if (/^\d{1,2}-\d{1,2}-\d{4}/.test(v)) out.date_format = 'DD-MM-YYYY';
  }

  return { spec: out, headers, sample, sniff: best };
}

export function suggestPDFSpec(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const candidates = [
    {
      name: 'MM/DD MM/DD desc $amount',
      regex: '^(\\d{1,2}/\\d{1,2})\\s+(\\d{1,2}/\\d{1,2})\\s+(.+?)\\s+\\$?(-?[\\d,]+\\.\\d{2})$',
      groups: { transaction_date: 1, posted_date: 2, description: 3, amount: 4 },
      date_format: 'MM/DD'
    },
    {
      name: 'MM/DD desc $amount',
      regex: '^(\\d{1,2}/\\d{1,2})\\s+(.+?)\\s+\\$?(-?[\\d,]+\\.\\d{2})$',
      groups: { transaction_date: 1, description: 2, amount: 3 },
      date_format: 'MM/DD'
    },
    {
      name: 'YYYY-MM-DD desc amount',
      regex: '^(\\d{4}-\\d{2}-\\d{2})\\s+(.+?)\\s+\\$?(-?[\\d,]+\\.\\d{2})$',
      groups: { transaction_date: 1, description: 2, amount: 3 },
      date_format: 'YYYY-MM-DD'
    },
    {
      name: 'Mon DD desc amount',
      regex: '^([A-Z][a-z]{2}\\s+\\d{1,2})\\s+(.+?)\\s+\\$?(-?[\\d,]+\\.\\d{2})$',
      groups: { transaction_date: 1, description: 2, amount: 3 },
      date_format: 'auto'
    }
  ];

  let best = null;
  for (const c of candidates) {
    const re = new RegExp(c.regex);
    const matches = lines.filter(l => re.test(l)).length;
    if (matches >= 3 && (!best || matches > best.matches)) best = { ...c, matches };
  }

  if (!best) return null;

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

  return {
    spec: {
      type: 'pdf',
      line_regex: best.regex,
      groups: best.groups,
      date_format: best.date_format,
      year,
      amount_handling: 'single_signed',
      amount_sign: 'natural',
      account_type: 'credit_card',
      default_account: '',
      default_currency: getCurrency()
    },
    sample_matches: lines.filter(l => new RegExp(best.regex).test(l)).slice(0, 5),
    candidate: best
  };
}
