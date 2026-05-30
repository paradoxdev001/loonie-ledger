import { MONTH_ABBR } from '../constants.js';
import { parseDate, parseAmount, formatMoney, getCurrency } from '../utils.js';
import { inferTxnType } from './categorizer.js';

const Papa = window.Papa;
const pdfjsLib = window.pdfjsLib;

if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

export function detectFormat(filename, sample) {
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.csv') || f.endsWith('.tsv')) return 'csv';
  if (f.endsWith('.pdf')) return 'pdf';
  if (f.endsWith('.qfx') || f.endsWith('.ofx')) return 'ofx';
  if (sample && sample.slice(0,4) === '%PDF') return 'pdf';
  if (sample && /[\,\;\t]/.test(sample.slice(0,200))) return 'csv';
  return 'unknown';
}

export async function readFileForParse(file, format) {
  if (format === 'pdf') {
    const buf = await file.arrayBuffer();
    return { kind: 'pdf', data: new Uint8Array(buf) };
  }
  const text = await file.text();
  return { kind: 'text', data: text };
}

export async function pdfToText(uint8) {
  const loadingTask = pdfjsLib.getDocument({ data: uint8.slice() });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: Math.round(it.transform[5])
    }));
    const lines = {};
    items.forEach(it => {
      const key = it.y;
      if (!lines[key]) lines[key] = [];
      lines[key].push(it);
    });
    const sortedKeys = Object.keys(lines).map(Number).sort((a,b) => b - a);
    const pageLines = sortedKeys.map(k =>
      lines[k].sort((a,b) => a.x - b.x).map(it => it.str).join(' ').replace(/\s+/g,' ').trim()
    ).filter(Boolean);
    pages.push(pageLines.join('\n'));
  }
  return pages.join('\n\n');
}

export async function pdfToRows(uint8) {
  const loadingTask = pdfjsLib.getDocument({ data: uint8.slice() });
  const pdf = await loadingTask.promise;
  const allRows = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: Math.round(it.transform[5])
    }));
    const byY = {};
    items.forEach(it => {
      if (!byY[it.y]) byY[it.y] = [];
      byY[it.y].push(it);
    });
    Object.keys(byY).map(Number).sort((a,b) => b - a).forEach(y => {
      allRows.push({ y, page: i, items: byY[y].sort((a,b) => a.x - b.x) });
    });
  }
  return allRows;
}

export function bucketByColumns(items, columns) {
  const out = {};
  for (const col of columns) {
    const cells = items.filter(it => it.x >= col.x_min && it.x < col.x_max);
    out[col.name] = cells.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  return out;
}

export function parseCSVText(text, spec) {
  const parsed = Papa.parse(text.replace(/^﻿/, ''), {
    delimiter: spec.delimiter || '',
    skipEmptyLines: true,
  });
  let rows = parsed.data;
  if (spec.skip_top_rows) rows = rows.slice(spec.skip_top_rows);
  if (spec.skip_bottom_rows) rows = rows.slice(0, rows.length - spec.skip_bottom_rows);

  let headers = null;
  if (spec.has_header) {
    headers = rows[0].map(h => String(h || '').trim());
    rows = rows.slice(1);
  }
  return { headers, rows };
}

function colIndex(ref, headers) {
  if (ref === null || ref === undefined || ref === '') return -1;
  if (typeof ref === 'number') return ref;
  if (headers) {
    const idx = headers.findIndex(h => h.toLowerCase() === String(ref).toLowerCase());
    if (idx >= 0) return idx;
  }
  const n = parseInt(ref, 10);
  return isNaN(n) ? -1 : n;
}

function getCell(row, ref, headers) {
  const i = colIndex(ref, headers);
  return i >= 0 && i < row.length ? row[i] : null;
}

export function buildYearResolver(fullText, spec, fallbackYear) {
  let map = null;
  let matched = false;
  if (spec.period_regex && spec.period_groups) {
    try {
      const periodRe = new RegExp(spec.period_regex, spec.period_regex_flags || '');
      const pm = fullText.match(periodRe);
      if (pm) {
        const g = spec.period_groups;
        const startKey = String(pm[g.start_month] || '').toUpperCase().slice(0,3);
        const endKey = String(pm[g.end_month] || '').toUpperCase().slice(0,3);
        let startYear = parseInt(pm[g.start_year], 10);
        let endYear = parseInt(pm[g.end_year], 10);
        if (startYear && startYear < 100) startYear += 2000;
        if (endYear && endYear < 100) endYear += 2000;
        const startMonth = MONTH_ABBR[startKey];
        const endMonth = MONTH_ABBR[endKey];
        if (!startYear && endYear && startMonth && endMonth) {
          startYear = endYear;
          if (parseInt(startMonth, 10) > parseInt(endMonth, 10)) startYear = endYear - 1;
        }
        if (startMonth && endMonth && startYear && endYear) {
          matched = true;
          map = {};
          let y = startYear;
          let mm = parseInt(startMonth, 10);
          const endMm = parseInt(endMonth, 10);
          for (let safety = 0; safety < 36; safety++) {
            map[mm] = y;
            if (y === endYear && mm === endMm) break;
            mm++;
            if (mm > 12) { mm = 1; y++; }
          }
        }
        if (!matched && !startMonth && endMonth && endYear) {
          matched = true;
          map = {};
          const endMm = parseInt(endMonth, 10);
          for (let mm = 1; mm <= 12; mm++) {
            map[mm] = mm <= endMm ? endYear : endYear - 1;
          }
        }
      }
    } catch (e) { /* invalid period_regex */ }
  }
  const resolver = (dateStr, postedStr) => {
    if (map && dateStr) {
      const match = String(dateStr).trim().match(/^([A-Za-z]{3})/);
      if (match) {
        const key = MONTH_ABBR[match[1].toUpperCase()];
        if (key) {
          const transMm = parseInt(key, 10);
          if (map[transMm]) return map[transMm];
          if (postedStr) {
            const pmatch = String(postedStr).trim().match(/^([A-Za-z]{3})/);
            if (pmatch) {
              const postKey = MONTH_ABBR[pmatch[1].toUpperCase()];
              if (postKey) {
                const postMm = parseInt(postKey, 10);
                if (map[postMm]) return transMm <= postMm ? map[postMm] : map[postMm] - 1;
              }
            }
          }
        }
      }
    }
    return fallbackYear;
  };
  resolver.matchedPeriod = matched;
  return resolver;
}

export async function applyConverter(file, raw, spec, ctx={}) {
  const txns = [];
  const errors = [];
  const accountType = spec.account_type || 'chequing';
  const currency = spec.default_currency || getCurrency();

  if (spec.type === 'csv') {
    const text = raw.kind === 'text' ? raw.data : new TextDecoder().decode(raw.data);
    const { headers, rows } = parseCSVText(text, spec);

    rows.forEach((row, i) => {
      try {
        const dateStr = getCell(row, spec.columns.transaction_date, headers);
        const postedStr = spec.columns.posted_date ? getCell(row, spec.columns.posted_date, headers) : null;
        const description = String(getCell(row, spec.columns.description, headers) || '').trim();
        if (!description && !dateStr) return;

        const transaction_date = parseDate(dateStr, spec.date_format || 'auto');
        if (!transaction_date) {
          errors.push({ row: i+1, error: `Could not parse date "${dateStr}"` });
          return;
        }
        const posted_date = postedStr ? parseDate(postedStr, spec.date_format || 'auto') : null;

        let signed = null;
        if (spec.amount_handling === 'split_debit_credit') {
          const debit = parseAmount(getCell(row, spec.columns.debit, headers));
          const credit = parseAmount(getCell(row, spec.columns.credit, headers));
          if (debit && debit !== 0) signed = -Math.abs(debit);
          else if (credit && credit !== 0) signed = Math.abs(credit);
        } else {
          signed = parseAmount(getCell(row, spec.columns.amount, headers));
        }

        if (signed === null) {
          errors.push({ row: i+1, error: 'Could not parse amount' });
          return;
        }

        if (spec.amount_sign === 'flipped') signed = -signed;

        const merchant = spec.columns.merchant
          ? (String(getCell(row, spec.columns.merchant, headers) || '').trim() || null)
          : null;
        const csvCategory = spec.columns.category
          ? (String(getCell(row, spec.columns.category, headers) || '').trim() || null)
          : null;

        const txnType = inferTxnType(signed, accountType, description);

        txns.push({
          transaction_date,
          posted_date,
          description,
          merchant,
          amount: Math.abs(signed),
          signed_amount: signed,
          currency,
          category: csvCategory,
          transaction_type: txnType,
          institution: spec.institution || ctx.institution,
          account_name: ctx.account_name || spec.default_account,
          account_type: accountType
        });
      } catch (e) {
        errors.push({ row: i+1, error: e.message });
      }
    });
  } else if (spec.type === 'pdf') {
    const columnMode = spec.layout === 'columns' && Array.isArray(spec.columns);
    let text;
    let rows = null;
    if (columnMode) {
      rows = raw.kind === 'pdf' ? await pdfToRows(raw.data) : [];
      text = rows.map(r => r.items.map(it => it.str).join(' ')).join('\n');
    } else {
      text = raw.kind === 'pdf' ? await pdfToText(raw.data) : raw.data;
    }
    const fmt = spec.date_format || 'auto';
    const fallbackYear = spec.year || ctx.statement_year || new Date().getFullYear();
    const yearFor = buildYearResolver(text, spec, fallbackYear);

    if (spec.period_regex && !yearFor.matchedPeriod) {
      errors.push({
        row: 0,
        error: `Could not detect statement period from PDF header. All transactions assigned year ${fallbackYear} — dates may be wrong. Check the converter's period_regex.`
      });
    }

    if (columnMode) {
      const sectionStartRe = spec.account_section_regex
        ? new RegExp(spec.account_section_regex, spec.account_section_regex_flags || '')
        : null;
      const sectionEndRe = spec.account_section_end_regex
        ? new RegExp(spec.account_section_end_regex, spec.account_section_end_regex_flags || '')
        : null;
      let inSection = !sectionStartRe;
      let lastEmitted = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowText = row.items.map(it => it.str).join(' ');
        if (sectionStartRe && !inSection) {
          if (sectionStartRe.test(rowText)) inSection = true;
          continue;
        }
        if (sectionEndRe && sectionEndRe.test(rowText)) {
          inSection = false;
          lastEmitted = null;
          continue;
        }
        if (!inSection) continue;

        const b = bucketByColumns(row.items, spec.columns);
        const dateStr = b.date || '';
        const transaction_date = dateStr ? parseDate(dateStr, fmt, yearFor(dateStr)) : null;

        if (!transaction_date) {
          if (spec.merge_continuation_rows && lastEmitted) {
            const cont = (b.description || '').trim();
            const hasAmounts = parseAmount(b.debit) || parseAmount(b.credit) || parseAmount(b.amount);
            if (cont && !hasAmounts) {
              lastEmitted.description = (lastEmitted.description + ' ' + cont).trim();
            }
          }
          continue;
        }

        let signed = null;
        if (spec.amount_handling === 'split_debit_credit') {
          const debit = parseAmount(b.debit);
          const credit = parseAmount(b.credit);
          if (debit && debit !== 0) signed = -Math.abs(debit);
          else if (credit && credit !== 0) signed = Math.abs(credit);
        } else {
          signed = parseAmount(b.amount);
        }
        if (signed === null || signed === 0) continue;
        if (spec.amount_sign === 'flipped') signed = -signed;

        let description = (b.description || '').trim();
        if (spec.description_strip_regex) {
          try {
            const stripRe = new RegExp(spec.description_strip_regex, spec.description_strip_regex_flags || '');
            description = description.replace(stripRe, '').trim();
          } catch (e) { /* invalid regex */ }
        }
        const txnType = inferTxnType(signed, accountType, description);
        const txn = {
          transaction_date,
          posted_date: null,
          description,
          merchant: null,
          amount: Math.abs(signed),
          signed_amount: signed,
          currency,
          category: null,
          transaction_type: txnType,
          institution: spec.institution || ctx.institution,
          account_name: ctx.account_name || spec.default_account,
          account_type: accountType
        };
        txns.push(txn);
        lastEmitted = txn;
      }
    } else {
      const lines = text.split('\n');
      const re = new RegExp(spec.line_regex, spec.line_regex_flags || '');
      const amountRe = spec.next_line_amount_regex
        ? new RegExp(spec.next_line_amount_regex, spec.next_line_amount_regex_flags || '')
        : null;
      const amountLookahead = spec.next_line_amount_lookahead || 5;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(re);
        if (!m) continue;
        try {
          const dateStr = m[spec.groups.transaction_date];
          const postedStr = spec.groups.posted_date ? m[spec.groups.posted_date] : null;

          const transaction_date = parseDate(dateStr, fmt, yearFor(dateStr, postedStr));
          if (!transaction_date) {
            errors.push({ row: i+1, error: `Could not parse date "${dateStr}"` });
            continue;
          }
          const posted_date = postedStr ? parseDate(postedStr, fmt, yearFor(postedStr)) : null;
          const description = (m[spec.groups.description] || '').trim();

          let amountMatch = m;
          if (amountRe) {
            let found = null;
            for (let j = 1; j <= amountLookahead && i + j < lines.length; j++) {
              const peek = lines[i + j];
              const am = peek.match(amountRe);
              if (am) { found = am; i = i + j; break; }
              if (peek.match(re)) break;
            }
            if (!found) {
              errors.push({ row: i+1, error: `Could not find amount on subsequent line for "${description}"` });
              continue;
            }
            amountMatch = found;
          }

          let signed = parseAmount(amountMatch[spec.groups.amount]);
          if (spec.groups.sign_marker && m[spec.groups.sign_marker]) {
            const sm = m[spec.groups.sign_marker];
            if (/-|CR/i.test(sm)) signed = -Math.abs(signed);
          }
          if (signed === null) { errors.push({ row: i+1, error: 'Could not parse amount' }); continue; }
          if (spec.amount_sign === 'flipped') signed = -signed;

          const txnType = inferTxnType(signed, accountType, description);
          txns.push({
            transaction_date, posted_date, description, merchant: null,
            amount: Math.abs(signed), signed_amount: signed, currency,
            category: null, transaction_type: txnType,
            institution: spec.institution || ctx.institution,
            account_name: ctx.account_name || spec.default_account,
            account_type: accountType
          });
        } catch (e) {
          errors.push({ row: i+1, error: e.message });
        }
      }
    }

    if (Array.isArray(spec.totals) && txns.length > 0) {
      for (const tot of spec.totals) {
        try {
          const rawFlags = tot.regex_flags || '';
          const flags = rawFlags.includes('g') ? rawFlags : rawFlags + 'g';
          const re = new RegExp(tot.regex, flags);
          const matches = [...text.matchAll(re)];
          if (matches.length === 0) continue;

          let expected = 0;
          for (const m of matches) {
            const v = parseAmount(m[1]);
            if (v !== null) expected += v;
          }
          if (spec.amount_sign === 'flipped') expected = -expected;
          if (tot.match === 'negative' && expected > 0) expected = -expected;
          if (tot.match === 'positive' && expected < 0) expected = -expected;

          const filter = tot.match || 'all';
          const actual = txns.reduce((acc, t) => {
            if (filter === 'positive') return t.signed_amount > 0 ? acc + t.signed_amount : acc;
            if (filter === 'negative') return t.signed_amount < 0 ? acc + t.signed_amount : acc;
            return acc + t.signed_amount;
          }, 0);

          const delta = actual - expected;
          if (Math.abs(delta) > 0.01) {
            errors.push({
              row: 0,
              error: `Total mismatch — ${tot.label || 'document total'}: document shows ${formatMoney(expected, currency)}, parsed sum is ${formatMoney(actual, currency)} (Δ ${formatMoney(delta, currency)}). The import isn't blocked, but check the parsed rows against the statement.`
            });
          }
        } catch (e) { /* malformed totals entry */ }
      }
    }
  } else {
    throw new Error(`Unknown spec type: ${spec.type}`);
  }

  return { transactions: txns, errors };
}
