import html from '../html.js';
import { useState, useEffect, useMemo, Fragment } from '../react.js';
import { useApp } from '../state.js';
import { dao, STORE } from '../db/store.js';
import { CATEGORIES, TXN_TYPES, TXN_TYPE_LABEL } from '../constants.js';
import { formatMoney, classNames, downloadBlob, formatDateDisplay } from '../utils.js';
import { inferTxnType, applyUserRules } from '../engine/categorizer.js';
import { Button, Card, Select, Badge, EmptyState, Modal, Label, Input, SourceInfoButton, HelpLink } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';
import { detectRecurring } from './Reports.js';

export function TransactionsView() {
  const { state, dispatch } = useApp();
  const [filters, setFilters] = useState({ from: '', to: '', search: '', account_id: '', category: '' });
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState({ col: 'transaction_date', dir: 'desc' });
  const [createRuleFor, setCreateRuleFor] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const activeIds = new Set(STORE.transactions.map(t => t.account_id));
    setAccounts(dao.listAccounts().filter(a => activeIds.has(a.id)));
    setRows(dao.listTransactions({
      from: filters.from || null,
      to: filters.to || null,
      search: filters.search || null,
      account_id: filters.account_id || null,
      category: filters.category || null
    }));
  }, [filters, state.refreshKey]);

  const sortedRows = useMemo(() => sortTransactions(rows, sort), [rows, sort]);

  const update = (id, fields) => {
    dao.updateTransaction(id, fields);
    dispatch({ type: 'REFRESH' });
  };
  const remove = (id) => {
    if (!confirm('Delete this transaction?')) return;
    dao.deleteTransaction(id);
    dispatch({ type: 'REFRESH' });
  };

  const recurringTxnIds = useMemo(() => detectRecurring(sortedRows).recurringTxnIds, [sortedRows]);
  const uncategorizedCount = useMemo(() => dao.countUncategorized(), [state.refreshKey]);

  return html`<${PageContainer}>
    <${PageHeader}
      title="Transactions"
      description=${`${rows.length} matching transactions`}
      action=${html`<div class="flex items-center gap-2">
        ${uncategorizedCount > 0 && html`<${Fragment}>
          <${Button} variant="secondary" onClick=${() => setAiOpen(true)}>
            AI Suggest (${uncategorizedCount})
          </${Button}>
          <${HelpLink} anchor="categorization" />
        </${Fragment}>`}
        <${Button} variant="secondary" onClick=${() => exportCsv(sortedRows)}>Export CSV</${Button}>
        <${Button} onClick=${() => dispatch({ type: 'SET_VIEW', view: 'upload' })}>Upload more</${Button}>
      </div>`}
    />

    <${Card} className="mb-6">
      <div class="p-4">
        <${TransactionFilters} filters=${filters} setFilters=${setFilters} accounts=${accounts} />
      </div>
    </${Card}>

    <${Card}>
      <${TransactionTable} rows=${sortedRows} update=${update} remove=${remove} recurringTxnIds=${recurringTxnIds} onCreateRule=${setCreateRuleFor} sort=${sort} setSort=${setSort} />
    </${Card}>

    <${CreateRuleModal} transaction=${createRuleFor} onClose=${() => setCreateRuleFor(null)} />
    <${AICategorizeModal} open=${aiOpen} onClose=${() => setAiOpen(false)} />
  </${PageContainer}>`;
}

function TransactionFilters({ filters, setFilters, accounts }) {
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    const t = setTimeout(() => setFilters(f => ({ ...f, search: searchDraft })), 300);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    if (filters.search !== searchDraft) setSearchDraft(filters.search);
  }, [filters.search]);

  return html`<div class="grid grid-cols-2 md:grid-cols-5 gap-3">
    <div>
      <${Label}>From</${Label}>
      <${Input} type="date" value=${filters.from} onChange=${e => setFilters({ ...filters, from: e.target.value })} />
    </div>
    <div>
      <${Label}>To</${Label}>
      <${Input} type="date" value=${filters.to} onChange=${e => setFilters({ ...filters, to: e.target.value })} />
    </div>
    <div>
      <${Label}>Account</${Label}>
      <${Select} value=${filters.account_id} onChange=${e => setFilters({ ...filters, account_id: e.target.value })}>
        <option value="">All accounts</option>
        ${accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.institution} · ${a.account_name}</option>`)}
      </${Select}>
    </div>
    <div>
      <${Label}>Category</${Label}>
      <${Select} value=${filters.category} onChange=${e => setFilters({ ...filters, category: e.target.value })}>
        <option value="">All categories</option>
        ${CATEGORIES.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
      </${Select}>
    </div>
    <div>
      <${Label}>Search</${Label}>
      <${Input} placeholder="Description or merchant" value=${searchDraft} onChange=${e => setSearchDraft(e.target.value)} />
    </div>
  </div>`;
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current]);
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

function TxnPaginator({ page, totalPages, total, pageSize, setPage, setPageSize }) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageNums = buildPageNumbers(page, totalPages);
  const btnBase = 'min-w-[2rem] px-2 py-1 rounded text-center transition-colors';
  return html`<div class="flex items-center justify-between px-4 py-2 text-sm text-ink-2">
    <span class="text-ink-mute whitespace-nowrap">${start}–${end} of ${total}</span>
    <div class="flex items-center gap-1">
      <button onClick=${() => setPage(p => p - 1)} disabled=${page === 1}
        class="px-2 py-1 rounded hover:bg-paper-3 disabled:opacity-40 disabled:cursor-not-allowed">‹</button>
      ${pageNums.map((n, i) =>
        n === '...'
          ? html`<span key=${'e' + i} class="px-1 text-ink-mute select-none">…</span>`
          : html`<button key=${n} onClick=${() => setPage(n)}
              class=${classNames(btnBase, n === page ? 'bg-maple text-ink font-medium' : 'hover:bg-paper-3')}>
              ${n}
            </button>`
      )}
      <button onClick=${() => setPage(p => p + 1)} disabled=${page === totalPages}
        class="px-2 py-1 rounded hover:bg-paper-3 disabled:opacity-40 disabled:cursor-not-allowed">›</button>
    </div>
    <div class="flex items-center gap-2 whitespace-nowrap">
      <span class="text-ink-mute">Per page</span>
      <select value=${pageSize} onChange=${e => { setPageSize(Number(e.target.value)); setPage(1); }}
        class="border border-rule rounded px-2 py-1 text-sm bg-paper-2">
        ${[25, 50, 75, 100].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
      </select>
    </div>
  </div>`;
}

function sortTransactions(rows, { col, dir }) {
  const m = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    let cmp;
    switch (col) {
      case 'transaction_date': cmp = (a.transaction_date || '').localeCompare(b.transaction_date || '') || (a.id - b.id); break;
      case 'description':      cmp = (a.description || '').localeCompare(b.description || ''); break;
      case 'account':          cmp = (a.institution || '').localeCompare(b.institution || '') || (a.account_name || '').localeCompare(b.account_name || ''); break;
      case 'category':         cmp = (a.category || '').localeCompare(b.category || ''); break;
      case 'transaction_type': cmp = (a.transaction_type || '').localeCompare(b.transaction_type || ''); break;
      case 'signed_amount':    cmp = (a.signed_amount || 0) - (b.signed_amount || 0); break;
      default:                 cmp = 0;
    }
    return m * cmp;
  });
}

function SortTh({ col, label, sort, setSort, align = 'left', className = '' }) {
  const active = sort.col === col;
  const toggle = () => setSort(s =>
    s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }
  );
  return html`<th class=${`px-3 py-2 cursor-pointer select-none hover:bg-paper-3 text-${align} ${className}`} onClick=${toggle}>
    <span class="inline-flex items-center gap-1">
      ${label}
      <span class=${active ? 'text-forest' : 'text-ink-mute'}>
        ${active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </span>
  </th>`;
}

function TransactionTable({ rows, update, remove, recurringTxnIds, onCreateRule, sort, setSort }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const recurringSet = recurringTxnIds || new Set();

  useEffect(() => { setPage(1); }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const showPaginator = totalPages > 1;
  const paginatorProps = { page, totalPages, total: rows.length, pageSize, setPage, setPageSize };

  return html`<div class="overflow-auto scrollbar-thin">
    ${showPaginator && html`<div class="border-b border-rule"><${TxnPaginator} ...${paginatorProps} /></div>`}
    <table class="w-full text-sm">
      <thead class="bg-paper text-ink-2 text-xs uppercase tracking-wide">
        <tr>
          <${SortTh} col="transaction_date" label="Date" sort=${sort} setSort=${setSort} />
          <${SortTh} col="description" label="Description" sort=${sort} setSort=${setSort} />
          <${SortTh} col="account" label="Account" sort=${sort} setSort=${setSort} />
          <${SortTh} col="category" label="Category" sort=${sort} setSort=${setSort} />
          <${SortTh} col="transaction_type" label="Type" sort=${sort} setSort=${setSort} />
          <${SortTh} col="signed_amount" label="Amount" sort=${sort} setSort=${setSort} align="right" />
          <th class="text-center px-3 py-2 w-20">Excluded</th>
          <th class="text-center px-3 py-2 w-12">Source</th>
          <th class="text-right px-3 py-2 w-16"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-rule">
        ${pageRows.map(r => {
          const signed = r.transaction_type === 'expense' || r.transaction_type === 'cc_payment'
            ? -Math.abs(r.amount) : (r.transaction_type === 'transfer' ? -Math.abs(r.amount) : Math.abs(r.amount));
          const isRecurring = recurringSet.has(r.id);
          return html`<tr key=${r.id} class=${classNames(r.is_excluded && 'opacity-50')}>
            <td class="px-3 py-2 font-mono whitespace-nowrap">${formatDateDisplay(r.transaction_date)}</td>
            <td class="px-3 py-2 max-w-[300px]" title=${r.description}>
              <div class="flex items-center gap-1.5">
                ${isRecurring && html`<span title="Recurring monthly charge" class="text-xs">🔁</span>`}
                <span class="truncate">${r.description}</span>
              </div>
            </td>
            <td class="px-3 py-2 text-xs text-ink-2">${r.institution} · ${r.account_name}</td>
            <td class="px-3 py-2">
              <${Select} value=${r.category || ''} onChange=${e => {
                const cat = e.target.value;
                const fields = { category: cat };
                if (cat === 'Transfer') {
                  fields.transaction_type = 'transfer';
                } else if (r.transaction_type === 'transfer') {
                  fields.transaction_type = inferTxnType(r.signed_amount, r.account_type, r.description);
                }
                update(r.id, fields);
              }} className="text-xs py-1 px-2">
                <option value="">—</option>
                ${CATEGORIES.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
              </${Select}>
            </td>
            <td class="px-3 py-2"><${Badge} color=${r.transaction_type==='income'?'green':r.transaction_type==='expense'?'red':'slate'}>${TXN_TYPE_LABEL[r.transaction_type]}</${Badge}></td>
            <td class=${classNames('px-3 py-2 text-right font-mono whitespace-nowrap', signed < 0 ? 'text-plum' : 'text-forest')}>
              ${formatMoney(signed)}
            </td>
            <td class="px-3 py-2 text-center">
              <input type="checkbox" checked=${!!r.is_excluded} onChange=${e => update(r.id, { is_excluded: e.target.checked ? 1 : 0 })} />
            </td>
            <td class="px-3 py-2 text-center">
              <${SourceInfoButton} documentId=${r.document_id} />
            </td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <button onClick=${() => onCreateRule && onCreateRule(r)} class="text-ink-mute hover:text-forest text-xs mr-2" title="Create category rule from this transaction">+rule</button>
              <button onClick=${() => remove(r.id)} class="text-plum hover:text-plum-deep">🗑</button>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${rows.length === 0 && html`<${EmptyState} icon="📋" title="No transactions" description="Try adjusting filters or upload more documents." />`}
    ${showPaginator && html`<div class="border-t border-rule"><${TxnPaginator} ...${paginatorProps} /></div>`}
  </div>`;
}

function exportCsv(rows) {
  const cols = ['transaction_date','posted_date','description','merchant','amount','currency','category','transaction_type','institution','account_name','is_excluded'];
  const csv = [
    cols.join(','),
    ...rows.map(r => cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
  ].join('\n');
  downloadBlob(csv, 'transactions.csv', 'text/csv');
}

function CreateRuleModal({ transaction, onClose }) {
  const { dispatch } = useApp();
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState('contains');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState(100);
  const [applyToExisting, setApplyToExisting] = useState(true);

  useEffect(() => {
    if (transaction) {
      setPattern(transaction.description || '');
      setMatchType('contains');
      setCategory(transaction.category || 'Other');
      setPriority(100);
      setApplyToExisting(true);
    }
  }, [transaction]);

  if (!transaction) return null;

  const save = () => {
    if (!pattern.trim() || !category) return;
    const rule = { pattern: pattern.trim(), match_type: matchType, category, priority: Number(priority) };
    dao.saveCategoryRule(rule);
    let updated = 0;
    if (applyToExisting) {
      for (const t of STORE.transactions) {
        if (applyUserRules(t.description, [rule])) {
          dao.updateTransaction(t.id, { category });
          updated++;
        }
      }
    }
    const msg = updated > 0
      ? `Rule saved: "${rule.pattern}" → ${category} (applied to ${updated} existing transaction${updated !== 1 ? 's' : ''})`
      : `Rule saved: "${rule.pattern}" → ${category}`;
    dispatch({ type: 'TOAST', toast: { kind: 'success', message: msg } });
    dispatch({ type: 'REFRESH' });
    onClose();
  };

  return html`<${Modal} open=${!!transaction} onClose=${onClose} title="Create category rule"
    footer=${html`<${Fragment}><${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} onClick=${save}>Save rule</${Button}></${Fragment}>`}>
    <div class="space-y-4 text-sm">
      <div>
        <${Label}>Pattern</${Label}>
        <${Input} value=${pattern} onChange=${e => setPattern(e.target.value)} className="font-mono" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <${Label}>Match type</${Label}>
          <${Select} value=${matchType} onChange=${e => setMatchType(e.target.value)}>
            <option value="contains">Contains</option>
            <option value="startswith">Starts with</option>
            <option value="regex">Regex</option>
          </${Select}>
        </div>
        <div>
          <${Label}>Priority (higher runs first)</${Label}>
          <${Input} type="number" value=${priority} onChange=${e => setPriority(e.target.value)} min="1" max="999" />
        </div>
      </div>
      <div>
        <${Label}>Category</${Label}>
        <${Select} value=${category} onChange=${e => setCategory(e.target.value)}>
          <option value="">— select —</option>
          ${CATEGORIES.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
        </${Select}>
      </div>
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked=${applyToExisting} onChange=${e => setApplyToExisting(e.target.checked)}
          class="w-4 h-4 rounded border-rule accent-maple" />
        <span class="text-ink-2">Apply to all existing transactions</span>
      </label>
    </div>
  </${Modal}>`;
}

const AI_AVAILABLE_CATS = CATEGORIES.filter(c =>
  !['Transfer','Credit Card Payment','Refund','Income','Other'].includes(c));

function buildAIPrompt(entries) {
  return `Categorize these personal finance transaction descriptions.
Choose the best category from: ${AI_AVAILABLE_CATS.join(', ')}.
Return ONLY valid JSON, no explanation: {"results":[{"i":0,"cat":"Dining"},{"i":1,"cat":"Groceries"},...]}

Transactions:
${entries.map((e, i) => `${i}: ${e.description}`).join('\n')}`;
}

function parseAIResponse(text, entries) {
  let parsed = {};
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {}
  const suggestions = [];
  for (const r of (parsed.results || [])) {
    const entry = entries[r.i];
    if (entry && AI_AVAILABLE_CATS.includes(r.cat)) {
      suggestions.push({ description: entry.description, category: r.cat, ids: entry.ids });
    }
  }
  return suggestions;
}

const AI_CAT_STORAGE_KEY = 'finance_ai_key_v1';

function AICategorizeModal({ open, onClose }) {
  const { state, dispatch } = useApp();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(AI_CAT_STORAGE_KEY) || '');
  const [keyDraft, setKeyDraft] = useState('');
  const [step, setStep] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [responseDraft, setResponseDraft] = useState('');
  const [parseError, setParseError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [accepted, setAccepted] = useState({});
  const [createRules, setCreateRules] = useState(true);

  const { entries, prompt } = useMemo(() => {
    if (!open) return { entries: [], prompt: '' };
    const groups = {};
    for (const t of dao.listTransactions({}).filter(t => !t.category || t.category === 'Other')) {
      const key = (t.description || '').toLowerCase().trim();
      if (!groups[key]) groups[key] = { description: t.description, ids: [] };
      groups[key].ids.push(t.id);
    }
    const entries = Object.values(groups);
    return { entries, prompt: buildAIPrompt(entries) };
  }, [open, state.refreshKey]);

  const reset = () => { setStep('idle'); setStatusMsg(''); setCopied(false); setResponseDraft(''); setParseError(''); setSuggestions([]); setAccepted({}); };
  const handleClose = () => { reset(); onClose(); };

  const saveKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    localStorage.setItem(AI_CAT_STORAGE_KEY, k);
    setApiKey(k);
    setKeyDraft('');
  };

  const runAPI = async () => {
    setStep('running');
    setSuggestions([]);
    setAccepted({});
    try {
      const BATCH = 150;
      const allSuggestions = [];
      for (let start = 0; start < entries.length; start += BATCH) {
        const batch = entries.slice(start, start + BATCH);
        setStatusMsg(`Categorizing ${Math.min(start + BATCH, entries.length)} of ${entries.length} descriptions…`);
        const batchPrompt = buildAIPrompt(batch);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-allow-browser': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: batchPrompt }]
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `API error ${res.status}`);
        }
        const data = await res.json();
        allSuggestions.push(...parseAIResponse(data.content?.[0]?.text || '', batch));
      }
      setSuggestions(allSuggestions);
      setAccepted(Object.fromEntries(allSuggestions.map((_, i) => [i, true])));
      setStep('review');
    } catch (e) {
      setStatusMsg(e.message || 'Unknown error');
      setStep('error');
    }
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setStep('paste'); });
  };

  const parseResponse = () => {
    setParseError('');
    const s = parseAIResponse(responseDraft, entries);
    if (s.length === 0) { setParseError('No valid suggestions found — make sure you pasted the full JSON response.'); return; }
    setSuggestions(s);
    setAccepted(Object.fromEntries(s.map((_, i) => [i, true])));
    setStep('review');
  };

  const apply = () => {
    const toApply = suggestions.filter((_, i) => accepted[i]);
    for (const s of toApply) {
      for (const id of s.ids) dao.updateTransaction(id, { category: s.category });
      if (createRules) dao.saveCategoryRule({ pattern: s.description, match_type: 'contains', category: s.category, priority: 50 });
    }
    dispatch({ type: 'REFRESH' });
    dispatch({ type: 'TOAST', toast: { kind: 'success', message: `Applied ${toApply.length} suggestion${toApply.length !== 1 ? 's' : ''}${createRules ? ' + saved rules' : ''}` } });
    handleClose();
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  const footer = step === 'review' ? html`<${Fragment}>
    <label class="flex items-center gap-2 text-sm mr-auto">
      <input type="checkbox" checked=${createRules} onChange=${e => setCreateRules(e.target.checked)} />
      Also create rules for accepted suggestions
    </label>
    <${Button} variant="ghost" onClick=${handleClose}>Cancel</${Button}>
    <${Button} onClick=${apply} disabled=${acceptedCount === 0}>Apply ${acceptedCount} suggestion${acceptedCount !== 1 ? 's' : ''}</${Button}>
  </${Fragment}>` : html`<${Button} variant="ghost" onClick=${handleClose}>Close</${Button}>`;

  return html`<${Modal} open=${open} onClose=${handleClose} title="AI category suggestions" size="lg" footer=${footer}>
    <div class="space-y-4 text-sm">
      ${(step === 'idle' || step === 'error') && html`<div class="space-y-4">
        <p><strong>${entries.length}</strong> unique description${entries.length !== 1 ? 's' : ''} to categorize.</p>

        ${step === 'error' && html`<div class="p-3 bg-plum-soft border border-plum-line rounded text-plum-deep text-xs">${statusMsg}</div>`}

        <div class="border border-rule rounded-lg p-4 space-y-3">
          <div class="font-medium">Option 1 — Anthropic API key</div>
          <p class="text-ink-mute text-xs">Runs automatically. Get a key at console.anthropic.com.</p>
          ${apiKey ? html`<div class="flex gap-2 items-center">
            <${Button} onClick=${runAPI}>Run AI categorization</${Button}>
            <button class="text-xs text-ink-mute hover:text-ink-2" onClick=${() => { localStorage.removeItem(AI_CAT_STORAGE_KEY); setApiKey(''); }}>Clear key</button>
          </div>` : html`<div class="flex gap-2">
            <${Input} type="password" placeholder="sk-ant-..." value=${keyDraft} onChange=${e => setKeyDraft(e.target.value)} onKeyDown=${e => e.key === 'Enter' && saveKey()} className="flex-1 font-mono text-xs" />
            <${Button} onClick=${saveKey} disabled=${!keyDraft.trim()}>Save & run</${Button}>
          </div>`}
        </div>

        <div class="border border-rule rounded-lg p-4 space-y-3">
          <div class="font-medium">Option 2 — Clipboard (no API key)</div>
          <p class="text-ink-mute text-xs">Copy the prompt, paste into Claude.ai, paste the JSON response back.</p>
          <${Button} variant="secondary" onClick=${copyPrompt}>${copied ? 'Copied!' : 'Copy prompt'}</${Button}>
        </div>
      </div>`}

      ${step === 'running' && html`<div class="py-8 text-center text-ink-mute">
        <div class="text-base mb-2">Running…</div>
        <div class="text-xs">${statusMsg}</div>
      </div>`}

      ${step === 'paste' && html`<div class="space-y-3">
        <p class="text-ink-2">Paste the AI's JSON response here:</p>
        <textarea
          value=${responseDraft}
          onChange=${e => { setResponseDraft(e.target.value); setParseError(''); }}
          rows="10"
          placeholder=${'{"results":[{"i":0,"cat":"Dining"},{"i":1,"cat":"Groceries"},...]}'}
          class="w-full font-mono text-xs border border-rule rounded p-3 resize-none focus:outline-none focus:ring-2 focus:ring-maple"
          autoFocus
        ></textarea>
        ${parseError && html`<p class="text-plum text-xs">${parseError}</p>`}
        <div class="flex gap-2">
          <${Button} onClick=${parseResponse} disabled=${!responseDraft.trim()}>Parse suggestions</${Button}>
          <${Button} variant="ghost" onClick=${() => setStep('idle')}>Back</${Button}>
        </div>
      </div>`}

      ${step === 'review' && html`<div class="space-y-3">
        <p>${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''} — uncheck any you want to skip.</p>
        <div class="flex gap-2 text-xs">
          <button class="text-forest hover:underline" onClick=${() => setAccepted(Object.fromEntries(suggestions.map((_, i) => [i, true])))}>Select all</button>
          <span class="text-ink-mute">|</span>
          <button class="text-ink-mute hover:underline" onClick=${() => setAccepted({})}>Deselect all</button>
        </div>
        <div class="max-h-96 overflow-auto border border-rule rounded">
          <table class="w-full text-xs">
            <thead class="bg-paper text-ink-mute uppercase tracking-wide sticky top-0">
              <tr>
                <th class="px-3 py-2 w-8"></th>
                <th class="text-left px-3 py-2">Description</th>
                <th class="text-left px-3 py-2">Suggested category</th>
                <th class="text-right px-3 py-2">Txns</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-rule-soft">
              ${suggestions.map((s, i) => html`<tr key=${i} class=${accepted[i] ? '' : 'opacity-40'}>
                <td class="px-3 py-1.5 text-center">
                  <input type="checkbox" checked=${!!accepted[i]} onChange=${e => setAccepted(a => ({ ...a, [i]: e.target.checked }))} />
                </td>
                <td class="px-3 py-1.5 font-mono max-w-xs truncate" title=${s.description}>${s.description}</td>
                <td class="px-3 py-1.5">
                  <${Select} value=${s.category} onChange=${e => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} className="text-xs py-0.5 px-1">
                    ${CATEGORIES.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
                  </${Select}>
                </td>
                <td class="px-3 py-1.5 text-right text-ink-mute">${s.ids.length}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </div>`}
    </div>
  </${Modal}>`;
}
