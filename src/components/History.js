import html from '../html.js';
import { useState, useEffect, Fragment } from '../react.js';
import { useApp } from '../state.js';
import { dao } from '../db/store.js';
import { Button, Card, Badge, EmptyState, Modal } from './ui/index.js';
import { PageContainer } from './Layout.js';

export function HistoryView() {
  const { state, dispatch } = useApp();
  const [docs, setDocs] = useState([]);
  const [confirmDoc, setConfirmDoc] = useState(null);

  useEffect(() => { setDocs(dao.listDocuments()); }, [state.refreshKey]);

  const statusColor = s => s === 'imported' ? 'green' : s === 'needs_converter' ? 'amber' : 'slate';

  const confirmTxnCount = confirmDoc ? dao.countTransactionsForDocument(confirmDoc.id) : 0;

  const handleDelete = () => {
    if (!confirmDoc) return;
    const id = confirmDoc.id;
    const filename = confirmDoc.filename;
    const removed = confirmTxnCount;
    dao.deleteDocument(id);
    setConfirmDoc(null);
    dispatch({ type: 'REFRESH' });
    dispatch({ type: 'TOAST', toast: {
      kind: 'success',
      message: `Deleted "${filename}"${removed ? ` and ${removed} transaction${removed !== 1 ? 's' : ''}` : ''}`
    } });
  };

  return html`<${PageContainer}>
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-slate-900">Upload history</h2>
      <p class="text-sm text-slate-500 mt-1">${docs.length} document${docs.length !== 1 ? 's' : ''} uploaded</p>
    </div>
    ${docs.length === 0
      ? html`<${EmptyState} icon="🗂" title="No uploads yet" description="Upload a bank statement to get started." />`
      : html`<${Card}>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide border-b border-slate-200">
                <tr>
                  <th class="text-left px-4 py-3">Date</th>
                  <th class="text-left px-4 py-3">File</th>
                  <th class="text-left px-4 py-3">Institution</th>
                  <th class="text-left px-4 py-3">Account</th>
                  <th class="text-left px-4 py-3">Converter</th>
                  <th class="text-left px-4 py-3">Status</th>
                  <th class="text-right px-4 py-3 w-16">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${docs.map(d => html`<tr key=${d.id} class="hover:bg-slate-50">
                  <td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600">
                    ${new Date(d.uploaded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td class="px-4 py-3 max-w-[240px]">
                    <span class="truncate block" title=${d.filename}>${d.filename}</span>
                    ${d.format && html`<span class="text-xs text-slate-400 uppercase">${d.format}</span>`}
                  </td>
                  <td class="px-4 py-3 text-slate-700">${d.institution || html`<span class="text-slate-400">—</span>`}</td>
                  <td class="px-4 py-3 text-slate-700">${d.account_name || html`<span class="text-slate-400">—</span>`}</td>
                  <td class="px-4 py-3 text-slate-700">${d.converter_name || html`<span class="text-slate-400">—</span>`}</td>
                  <td class="px-4 py-3">
                    <${Badge} color=${statusColor(d.status)}>${d.status}</${Badge}>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      onClick=${() => setConfirmDoc(d)}
                      title="Delete document and its transactions"
                      class="text-slate-400 hover:text-red-600 text-base"
                    >🗑</button>
                  </td>
                </tr>`)}
              </tbody>
            </table>
          </div>
        </${Card}>`
    }
    <${Modal}
      open=${!!confirmDoc}
      onClose=${() => setConfirmDoc(null)}
      title="Delete document?"
      size="sm"
      footer=${html`<${Fragment}>
        <${Button} variant="ghost" onClick=${() => setConfirmDoc(null)}>Cancel</${Button}>
        <${Button} variant="danger" onClick=${handleDelete}>Delete</${Button}>
      </${Fragment}>`}
    >
      ${confirmDoc && html`<div class="text-sm text-slate-700 space-y-3">
        <p>Delete <span class="font-mono break-all">${confirmDoc.filename}</span>?</p>
        <p class="text-slate-600">
          ${confirmTxnCount === 0
            ? 'No transactions are linked to this document.'
            : html`This will also remove <strong>${confirmTxnCount}</strong> linked transaction${confirmTxnCount !== 1 ? 's' : ''}.`}
        </p>
        <p class="text-xs text-slate-500">This cannot be undone.</p>
      </div>`}
    </${Modal}>
  </${PageContainer}>`;
}
