import { debounce, deriveSignedAmount, getCurrency } from '../utils.js';
import { BUILTIN_CONVERTERS, RETIRED_BUILTIN_KEYS } from '../data/builtinConverters.js';

const DB_NAME = 'household_finance_db';
const DB_STORE = 'kv';
const DB_KEY = 'state_v1';

export let STORAGE_MODE = 'memory';
let MEMORY_FALLBACK = {};

function tryIdbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not available'));
    let req;
    try { req = indexedDB.open(DB_NAME, 1); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore(DB_STORE); } catch (e) {}
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function detectStorageMode() {
  try {
    const db = await tryIdbOpen();
    db.close();
    STORAGE_MODE = 'idb';
    return;
  } catch (e) { /* fall through */ }

  try {
    const k = '__test_' + Math.random();
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    STORAGE_MODE = 'localstorage';
    return;
  } catch (e) { /* fall through */ }

  STORAGE_MODE = 'memory';
}

async function idbGet(key) {
  if (STORAGE_MODE === 'memory') return MEMORY_FALLBACK[key] ?? null;
  if (STORAGE_MODE === 'localstorage') {
    const raw = localStorage.getItem(DB_NAME + ':' + key);
    return raw ? JSON.parse(raw) : null;
  }
  const db = await tryIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  if (STORAGE_MODE === 'memory') { MEMORY_FALLBACK[key] = value; return; }
  if (STORAGE_MODE === 'localstorage') {
    try { localStorage.setItem(DB_NAME + ':' + key, JSON.stringify(value)); }
    catch (e) {
      STORAGE_MODE = 'memory';
      MEMORY_FALLBACK[key] = value;
    }
    return;
  }
  const db = await tryIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  if (STORAGE_MODE === 'memory') { delete MEMORY_FALLBACK[key]; return; }
  if (STORAGE_MODE === 'localstorage') { localStorage.removeItem(DB_NAME + ':' + key); return; }
  const db = await tryIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const blankStore = () => ({
  accounts: [], converters: [], documents: [], transactions: [], category_rules: [],
  next_id: { accounts: 1, converters: 1, documents: 1, transactions: 1, category_rules: 1 }
});

export let STORE = blankStore();

export async function initDB() {
  await detectStorageMode();
  try {
    const saved = await idbGet(DB_KEY);
    if (saved && typeof saved === 'object') {
      STORE = { ...blankStore(), ...saved, next_id: { ...blankStore().next_id, ...(saved.next_id || {}) } };
    }
  } catch (e) {
    console.warn('Failed to load saved store, starting fresh:', e);
  }
  return STORE;
}

export const persistDB = debounce(async () => {
  try { await idbSet(DB_KEY, STORE); } catch (e) { console.warn('persist failed:', e); }
}, 200);

const persistNow = async () => {
  try { await idbSet(DB_KEY, STORE); } catch (e) { console.warn('persist failed:', e); }
};

const nextId = (table) => STORE.next_id[table]++;
const findById = (table, id) => STORE[table].find(r => r.id === Number(id));

export const dao = {
  listAccounts: () => [...STORE.accounts].sort((a,b) =>
    (a.institution || '').localeCompare(b.institution || '') ||
    (a.account_name || '').localeCompare(b.account_name || '')),
  upsertAccount: ({ institution, account_name, account_type, currency=getCurrency() }) => {
    const existing = STORE.accounts.find(a => a.institution === institution && a.account_name === account_name);
    if (existing) return existing.id;
    const id = nextId('accounts');
    STORE.accounts.push({ id, institution, account_name, account_type: account_type || null, currency });
    persistDB();
    return id;
  },

  listConverters: () => [...STORE.converters].sort((a,b) =>
    (a.institution || '').localeCompare(b.institution || '') ||
    (a.name || '').localeCompare(b.name || '')),
  getConverter: id => findById('converters', id),
  getConverterByKey: key => STORE.converters.find(c => c.key === key),
  findConverters: ({ institution, format, account_type }) => {
    return STORE.converters.filter(c =>
      (!institution || c.institution === institution) &&
      (!format || c.format === format) &&
      (!account_type || c.account_type === account_type || c.account_type == null)
    );
  },
  saveConverter: ({ id, key, name, institution, account_type, format, spec_json, notes, is_builtin = 0 }) => {
    if (id) {
      const c = findById('converters', id);
      if (c) Object.assign(c, { name, institution, account_type: account_type || null, format, spec_json, notes: notes || null });
      persistDB();
      return id;
    }
    const newId = nextId('converters');
    STORE.converters.push({
      id: newId, key, name, institution,
      account_type: account_type || null, format, spec_json,
      is_builtin, notes: notes || null,
      created_at: new Date().toISOString()
    });
    persistDB();
    return newId;
  },
  deleteConverter: id => {
    STORE.converters = STORE.converters.filter(c => c.id !== Number(id));
    persistDB();
  },

  insertDocument: (doc) => {
    const id = nextId('documents');
    STORE.documents.push({
      id,
      filename: doc.filename, format: doc.format,
      institution: doc.institution || null, account_id: doc.account_id || null,
      converter_id: doc.converter_id || null, status: doc.status || 'uploaded',
      raw_size: doc.raw_size || null, notes: doc.notes || null,
      uploaded_at: new Date().toISOString()
    });
    persistDB();
    return id;
  },
  updateDocumentStatus: (id, status) => {
    const d = findById('documents', id);
    if (d) { d.status = status; persistDB(); }
  },
  listDocuments: () => {
    return [...STORE.documents]
      .map(d => ({
        ...d,
        account_name: findById('accounts', d.account_id)?.account_name || null,
        converter_name: findById('converters', d.converter_id)?.name || null
      }))
      .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
  },
  getDocument: id => {
    const d = findById('documents', id);
    if (!d) return null;
    return {
      ...d,
      account_name: findById('accounts', d.account_id)?.account_name || null,
      converter_name: findById('converters', d.converter_id)?.name || null
    };
  },
  countTransactionsForDocument: id => {
    const did = Number(id);
    return STORE.transactions.filter(t => t.document_id === did).length;
  },
  deleteDocument: id => {
    const did = Number(id);
    STORE.transactions = STORE.transactions.filter(t => t.document_id !== did);
    STORE.documents = STORE.documents.filter(d => d.id !== did);
    persistDB();
  },

  insertTransaction: tx => {
    if (STORE.transactions.find(t => t.account_id === tx.account_id && t.fingerprint === tx.fingerprint)) {
      return null;
    }
    const id = nextId('transactions');
    const signed = typeof tx.signed_amount === 'number'
      ? tx.signed_amount
      : deriveSignedAmount(tx);
    STORE.transactions.push({
      id,
      document_id: tx.document_id || null, account_id: tx.account_id || null,
      transaction_date: tx.transaction_date, posted_date: tx.posted_date || null,
      description: tx.description, merchant: tx.merchant || null,
      amount: tx.amount, signed_amount: signed, currency: tx.currency || getCurrency(),
      category: tx.category || null, transaction_type: tx.transaction_type || 'expense',
      is_excluded: tx.is_excluded ? 1 : 0, fingerprint: tx.fingerprint,
      created_at: new Date().toISOString()
    });
    return id;
  },
  isDuplicate: (account_id, fp) => {
    return STORE.transactions.some(t => t.account_id === account_id && t.fingerprint === fp);
  },
  listTransactions: (filters = {}) => {
    const aid = filters.account_id ? Number(filters.account_id) : null;
    const search = filters.search ? filters.search.toLowerCase() : null;
    const accountMap = new Map(STORE.accounts.map(a => [a.id, a]));
    const rows = STORE.transactions.filter(t => {
      if (filters.from && t.transaction_date < filters.from) return false;
      if (filters.to && t.transaction_date > filters.to) return false;
      if (aid && t.account_id !== aid) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (search) {
        const d = (t.description || '').toLowerCase(), m = (t.merchant || '').toLowerCase();
        if (!d.includes(search) && !m.includes(search)) return false;
      }
      return true;
    }).map(t => {
      const a = accountMap.get(t.account_id);
      const signed = typeof t.signed_amount === 'number' ? t.signed_amount : deriveSignedAmount(t);
      return { ...t, signed_amount: signed, account_name: a?.account_name || null, institution: a?.institution || null, account_type: a?.account_type || null };
    });
    rows.sort((a, b) =>
      (b.transaction_date || '').localeCompare(a.transaction_date || '') ||
      b.id - a.id);
    return rows;
  },
  countUncategorized: () =>
    STORE.transactions.filter(t => !t.category || t.category === 'Other').length,
  updateTransaction: (id, fields) => {
    const t = findById('transactions', id);
    if (t) { Object.assign(t, fields); persistDB(); }
  },
  deleteTransaction: id => {
    STORE.transactions = STORE.transactions.filter(t => t.id !== Number(id));
    persistDB();
  },
  bulkInsertTransactions: txs => {
    let inserted = 0, skipped = 0;
    for (const t of txs) {
      if (dao.insertTransaction(t)) inserted++; else skipped++;
    }
    persistDB();
    return { inserted, skipped };
  },

  listCategoryRules: () => [...STORE.category_rules].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) || a.id - b.id),
  saveCategoryRule: ({ id, pattern, match_type = 'contains', category, priority = 100 }) => {
    if (id) {
      const r = findById('category_rules', id);
      if (r) Object.assign(r, { pattern, match_type, category, priority });
    } else {
      const newId = nextId('category_rules');
      STORE.category_rules.push({ id: newId, pattern, match_type, category, priority });
    }
    persistDB();
  },
  deleteCategoryRule: id => {
    STORE.category_rules = STORE.category_rules.filter(r => r.id !== Number(id));
    persistDB();
  },

  resetAll: async () => {
    STORE = blankStore();
    await persistNow();
  },
  exportDB: () => {
    const json = JSON.stringify(STORE, null, 2);
    return new TextEncoder().encode(json);
  },
  importDB: async (uint8) => {
    const text = new TextDecoder().decode(uint8);
    const parsed = JSON.parse(text);
    STORE = { ...blankStore(), ...parsed, next_id: { ...blankStore().next_id, ...(parsed.next_id || {}) } };
    await persistNow();
  }
};

export async function seedBuiltins() {
  const existing = dao.listConverters();
  existing.filter(c => c.is_builtin && RETIRED_BUILTIN_KEYS.has(c.key))
    .forEach(c => dao.deleteConverter(c.id));

  const existingKeys = new Set(dao.listConverters().map(c => c.key));
  for (const c of BUILTIN_CONVERTERS) {
    if (!existingKeys.has(c.key)) {
      dao.saveConverter({
        key: c.key, name: c.name, institution: c.institution,
        account_type: c.account_type, format: c.format,
        spec_json: JSON.stringify(c.spec), notes: c.notes, is_builtin: 1
      });
    }
  }
  migrateBuiltinSpecs(existing);
  for (const t of STORE.transactions) {
    if (t.category === 'Transfer' && t.transaction_type !== 'transfer') {
      t.transaction_type = 'transfer';
    }
  }
  persistDB();
}

function migrateBuiltinSpecs(existing) {
  const OLD_RBC_VISA_PERIOD = 'STATEMENT\\s+FROM\\s+([A-Z]{3})\\s+\\d{1,2},\\s+(\\d{4})\\s+TO\\s+([A-Z]{3})\\s+\\d{1,2},\\s+(\\d{4})';
  const OLD_RBC_VISA_LINE = '^([A-Z]{3}\\s+\\d{1,2})\\s+([A-Z]{3}\\s+\\d{1,2})\\s+(.+?)\\s+(-?\\$[\\d,]+\\.\\d{2})$';
  const rbcVisa = existing.find(c => c.key === 'rbc_visa_pdf_v1');
  if (rbcVisa) {
    try {
      const spec = JSON.parse(rbcVisa.spec_json);
      const fresh = BUILTIN_CONVERTERS.find(b => b.key === 'rbc_visa_pdf_v1');
      const needsPeriodFix = spec.period_regex === OLD_RBC_VISA_PERIOD;
      const needsLineFix = spec.line_regex === OLD_RBC_VISA_LINE;
      const needsTotals = !Array.isArray(spec.totals);
      if (fresh && (needsPeriodFix || needsLineFix || needsTotals)) {
        dao.saveConverter({
          id: rbcVisa.id,
          key: rbcVisa.key,
          name: fresh.name,
          institution: fresh.institution,
          account_type: fresh.account_type,
          format: fresh.format,
          spec_json: JSON.stringify(fresh.spec),
          notes: fresh.notes
        });
      }
    } catch (e) { /* malformed spec_json */ }
  }

  const bmo = existing.find(c => c.key === 'bmo_interest_chequing_pdf_v1');
  if (bmo) {
    try {
      const spec = JSON.parse(bmo.spec_json);
      const fresh = BUILTIN_CONVERTERS.find(b => b.key === 'bmo_interest_chequing_pdf_v1');
      const needsStripRegex = !spec.description_strip_regex;
      const needsLooserStartRe = spec.account_section_regex && spec.account_section_regex.includes('\\s+');
      const needsLooserEndRe = spec.account_section_end_regex === 'Closing\\s+totals';
      if (fresh && (needsStripRegex || needsLooserStartRe || needsLooserEndRe)) {
        dao.saveConverter({
          id: bmo.id,
          key: bmo.key,
          name: fresh.name,
          institution: fresh.institution,
          account_type: fresh.account_type,
          format: fresh.format,
          spec_json: JSON.stringify(fresh.spec),
          notes: fresh.notes
        });
      }
    } catch (e) { /* malformed spec_json */ }
  }
}
