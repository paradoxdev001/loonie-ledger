import html from '../html.js';
import { useState, useEffect } from '../react.js';
import { useApp } from '../state.js';
import { dao } from '../db/store.js';
import { CATEGORIES, TXN_TYPES, TXN_TYPE_LABEL } from '../constants.js';
import { formatMoney, classNames, formatBatchSummary } from '../utils.js';
import { Button, Card, CardHeader, Select, Badge, StatTile, EmptyState, Input } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

export function ReviewView() {
  const { state, dispatch } = useApp();
  const review = state.pendingReview;
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (review) {
      setItems(review.transactions.map((t, i) => ({ ...t, _id: i, _confirmed: !t._duplicate })));
    }
  }, [review]);

  if (!review) {
    return html`<${PageContainer}>
      <${EmptyState}
        icon="📋"
        title="Nothing to review"
        description="Upload a document and pick a converter to see transactions here."
        action=${html`<${Button} onClick=${() => dispatch({ type: 'SET_VIEW', view: 'upload' })}>Go to Upload</${Button}>`}
      />
    </${PageContainer}>`;
  }

  const updateItem = (idx, patch) => setItems(items => items.map((t, i) => i === idx ? { ...t, ...patch } : t));
  const removeItem = idx => setItems(items => items.filter((_, i) => i !== idx));

  const filteredIdx = items
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      if (filter === 'duplicates') return t._duplicate;
      if (filter === 'excluded') return t.is_excluded;
      if (filter === 'issues') return t._duplicate || !t.transaction_date || !t.amount;
      return true;
    });

  const counts = {
    total: items.length,
    duplicates: items.filter(t => t._duplicate).length,
    excluded: items.filter(t => t.is_excluded).length,
    toImport: items.filter(t => t._confirmed && !t.is_excluded && !t._duplicate).length
  };

  const advanceOrFinish = (toast) => {
    if (state.batchQueue.length > 0) {
      const next = state.batchQueue[0];
      dispatch({ type: 'BATCH_ADVANCE' });
      dispatch({ type: 'SET_REVIEW', payload: next.parsedReview });
      if (toast) dispatch({ type: 'TOAST', toast });
      return;
    }
    dispatch({ type: 'CLEAR_REVIEW' });
    if (state.batchStats) {
      dispatch({ type: 'TOAST', toast: { kind: 'success', message: formatBatchSummary(state.batchStats) } });
      dispatch({ type: 'SET_VIEW', view: 'upload' });
    } else {
      if (toast) dispatch({ type: 'TOAST', toast });
      dispatch({ type: 'SET_VIEW', view: 'transactions' });
    }
  };

  const importAll = async () => {
    setBusy(true);
    try {
      const toInsert = items
        .filter(t => t._confirmed && !t._duplicate)
        .map(t => ({
          document_id: review.document_id,
          account_id: review.account_id,
          transaction_date: t.transaction_date,
          posted_date: t.posted_date,
          description: t.description,
          merchant: t.merchant,
          amount: t.amount,
          currency: t.currency,
          category: t.category,
          transaction_type: t.transaction_type,
          is_excluded: t.is_excluded ? 1 : 0,
          fingerprint: t.fingerprint
        }));
      const { inserted, skipped } = dao.bulkInsertTransactions(toInsert);
      dao.updateDocumentStatus(review.document_id, 'imported');
      dispatch({ type: 'REFRESH' });
      advanceOrFinish({ kind: 'success', message: `Imported ${inserted} transactions${skipped ? ` (${skipped} skipped)` : ''}` });
    } catch (e) {
      console.error(e);
      dispatch({ type: 'TOAST', toast: { kind: 'error', message: 'Import failed: ' + e.message } });
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = () => {
    if (state.batchStats) {
      advanceOrFinish({ kind: 'info', message: `Skipped ${review.account_name || 'file'}` });
    } else {
      dispatch({ type: 'CLEAR_REVIEW' });
    }
  };

  const batchPosition = state.batchStats?.queuedForReview > 0
    ? { current: state.batchStats.queuedForReview - state.batchQueue.length, total: state.batchStats.queuedForReview }
    : null;

  return html`<${PageContainer}>
    ${batchPosition && html`<div class="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center justify-between">
      <span>Batch review — file <span class="font-semibold">${batchPosition.current}</span> of ${batchPosition.total}</span>
      <span class="text-xs text-emerald-700">
        ${state.batchStats.autoImported > 0 && `${state.batchStats.autoImported} auto-imported`}
        ${state.batchStats.autoImported > 0 && state.batchStats.skippedNoHint > 0 && ' · '}
        ${state.batchStats.skippedNoHint > 0 && `${state.batchStats.skippedNoHint} unrecognized`}
      </span>
    </div>`}
    <${PageHeader}
      title="Review extracted transactions"
      description=${`${review.account_name} · parsed from ${review.transactions.length} rows`}
      action=${html`<div class="flex items-center gap-2">
        <${Button} variant="ghost" onClick=${onDiscard}>${state.batchStats ? 'Skip file' : 'Discard'}</${Button}>
        <${Button} variant="success" onClick=${importAll} disabled=${busy || counts.toImport === 0}>
          Import ${counts.toImport} ${counts.toImport === 1 ? 'transaction' : 'transactions'}
        </${Button}>
      </div>`}
    />

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <${StatTile} label="Total parsed" value=${counts.total} />
      <${StatTile} label="Duplicates" value=${counts.duplicates} color=${counts.duplicates ? 'amber' : 'slate'} />
      <${StatTile} label="Excluded" value=${counts.excluded} />
      <${StatTile} label="Will import" value=${counts.toImport} color="green" />
    </div>

    <${Card}>
      <${CardHeader}
        title="Transactions"
        right=${html`<${Select} value=${filter} onChange=${e => setFilter(e.target.value)} className="w-40">
          <option value="all">All</option>
          <option value="duplicates">Duplicates</option>
          <option value="excluded">Excluded</option>
          <option value="issues">Issues only</option>
        </${Select}>`}
      />
      <${ReviewTable} items=${filteredIdx} updateItem=${updateItem} removeItem=${removeItem} />
    </${Card}>

    ${review.errors?.length > 0 && html`<details class="mt-6">
      <summary class="text-sm text-amber-700 hover:underline cursor-pointer">${review.errors.length} parse warnings</summary>
      <pre class="mt-2 text-xs bg-amber-50 border border-amber-200 rounded p-3 max-h-48 overflow-auto scrollbar-thin font-mono whitespace-pre-wrap">
${review.errors.map(e => e.row ? `Row ${e.row}: ${e.error}` : e.error).join('\n')}</pre>
    </details>`}
  </${PageContainer}>`;
}

function ReviewTable({ items, updateItem, removeItem }) {
  return html`<div class="overflow-auto scrollbar-thin">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide sticky top-0">
        <tr>
          <th class="text-left px-3 py-2 w-8"></th>
          <th class="text-left px-3 py-2">Date</th>
          <th class="text-left px-3 py-2">Description</th>
          <th class="text-left px-3 py-2">Merchant</th>
          <th class="text-left px-3 py-2">Category</th>
          <th class="text-left px-3 py-2">Type</th>
          <th class="text-right px-3 py-2">Amount</th>
          <th class="text-right px-3 py-2 w-24">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200">
        ${items.map(({ t, i }) => html`<${ReviewRow} key=${i} t=${t} idx=${i} updateItem=${updateItem} removeItem=${removeItem} />`)}
      </tbody>
    </table>
    ${items.length === 0 && html`<div class="py-10 text-center text-sm text-slate-500">No transactions match this filter.</div>`}
  </div>`;
}

function ReviewRow({ t, idx, updateItem, removeItem }) {
  return html`<tr class=${classNames(t._duplicate && 'bg-amber-50', t.is_excluded && 'opacity-50')}>
    <td class="px-3 py-2">
      <input
        type="checkbox"
        checked=${t._confirmed && !t._duplicate}
        onChange=${e => updateItem(idx, { _confirmed: e.target.checked })}
        disabled=${t._duplicate}
        class="rounded border-slate-300"
      />
    </td>
    <td class="px-3 py-2">
      <${Input}
        value=${t.transaction_date}
        onChange=${e => updateItem(idx, { transaction_date: e.target.value })}
        className="font-mono text-xs py-1 px-2"
      />
    </td>
    <td class="px-3 py-2 max-w-[260px]">
      <${Input}
        value=${t.description}
        onChange=${e => updateItem(idx, { description: e.target.value })}
        className="text-xs py-1 px-2"
      />
      ${t._duplicate && html`<${Badge} color="amber">duplicate</${Badge}>`}
    </td>
    <td class="px-3 py-2">
      <${Input}
        value=${t.merchant || ''}
        onChange=${e => updateItem(idx, { merchant: e.target.value })}
        className="text-xs py-1 px-2"
      />
    </td>
    <td class="px-3 py-2">
      <${Select}
        value=${t.category || ''}
        onChange=${e => updateItem(idx, { category: e.target.value })}
        className="text-xs py-1 px-2"
      >
        <option value="">—</option>
        ${CATEGORIES.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
      </${Select}>
    </td>
    <td class="px-3 py-2">
      <${Select}
        value=${t.transaction_type}
        onChange=${e => updateItem(idx, { transaction_type: e.target.value })}
        className="text-xs py-1 px-2"
      >
        ${TXN_TYPES.map(tt => html`<option key=${tt} value=${tt}>${TXN_TYPE_LABEL[tt]}</option>`)}
      </${Select}>
    </td>
    <td class=${classNames('px-3 py-2 text-right font-mono whitespace-nowrap', t.signed_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
      ${formatMoney(t.signed_amount)}
    </td>
    <td class="px-3 py-2 text-right">
      <div class="flex justify-end gap-1">
        <button
          onClick=${() => updateItem(idx, { is_excluded: !t.is_excluded })}
          title=${t.is_excluded ? 'Include' : 'Exclude'}
          class="text-slate-500 hover:text-slate-700 px-1.5"
        >${t.is_excluded ? '↺' : '∅'}</button>
        <button
          onClick=${() => removeItem(idx)}
          title="Delete"
          class="text-red-500 hover:text-red-700 px-1.5"
        >🗑</button>
      </div>
    </td>
  </tr>`;
}
