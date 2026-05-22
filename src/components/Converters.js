import html from '../html.js';
import { useState, useEffect, Fragment } from '../react.js';
import { useApp } from '../state.js';
import { dao, STORE } from '../db/store.js';
import { ACCOUNT_TYPE_LABEL } from '../constants.js';
import { Button, Card, CardHeader, Badge, EmptyState, Modal, Label, Input } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

export function ConvertersView() {
  const { state, dispatch } = useApp();
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [usageCounts, setUsageCounts] = useState({});

  const refresh = () => {
    setItems(dao.listConverters());
    const counts = {};
    STORE.documents.forEach(d => {
      if (d.converter_id) counts[d.converter_id] = (counts[d.converter_id] || 0) + 1;
    });
    setUsageCounts(counts);
  };
  useEffect(refresh, [state.refreshKey]);

  const onDelete = (c) => {
    if (!confirm(`Delete converter "${c.name}"? This won't affect already-imported transactions.`)) return;
    dao.deleteConverter(c.id);
    refresh();
    dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'Converter deleted' } });
  };

  return html`<${PageContainer}>
    <${PageHeader}
      title="Converters"
      description="Each converter parses one institution's document format deterministically. Edit, copy, or delete them — built-ins can be edited too."
    />

    <${Card}>
      <${CardHeader} title=${`${items.length} converters`} />
      <${ConverterList} items=${items} usageCounts=${usageCounts} onView=${c => setEditing(c)} onDelete=${onDelete} />
    </${Card}>

    ${editing && html`<${ConverterDetailModal}
      converter=${editing}
      onClose=${() => setEditing(null)}
      onSaved=${() => { setEditing(null); refresh(); dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'Saved' } }); }}
    />`}
  </${PageContainer}>`;
}

function ConverterList({ items, usageCounts, onView, onDelete }) {
  return html`<div class="overflow-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">Name</th>
          <th class="text-left px-4 py-2">Institution</th>
          <th class="text-left px-4 py-2">Account type</th>
          <th class="text-left px-4 py-2">Format</th>
          <th class="text-left px-4 py-2">Source</th>
          <th class="text-left px-4 py-2">Usage</th>
          <th class="text-right px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200">
        ${items.map(c => {
          const count = usageCounts[c.id] || 0;
          return html`<tr key=${c.id} class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium">${c.name}</td>
            <td class="px-4 py-3">${c.institution}</td>
            <td class="px-4 py-3">${ACCOUNT_TYPE_LABEL[c.account_type] || '—'}</td>
            <td class="px-4 py-3"><${Badge} color="slate">${c.format.toUpperCase()}</${Badge}></td>
            <td class="px-4 py-3">
              ${c.is_builtin ? html`<${Badge} color="blue">Built-in</${Badge}>` : html`<${Badge} color="violet">Custom</${Badge}>`}
            </td>
            <td class="px-4 py-3">
              ${count > 0
                ? html`<${Badge} color="green">${count} ${count === 1 ? 'import' : 'imports'}</${Badge}>`
                : html`<${Badge} color="slate">Never used</${Badge}>`}
            </td>
            <td class="px-4 py-3 text-right">
              <${Button} variant="ghost" size="sm" onClick=${() => onView(c)}>View</${Button}>
              <${Button} variant="ghost" size="sm" onClick=${() => onDelete(c)}>Delete</${Button}>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${items.length === 0 && html`<${EmptyState} icon="⚙" title="No converters yet" />`}
  </div>`;
}

function ConverterDetailModal({ converter, onClose, onSaved }) {
  const [name, setName] = useState(converter.name);
  const [notes, setNotes] = useState(converter.notes || '');
  const [specText, setSpecText] = useState(JSON.stringify(JSON.parse(converter.spec_json), null, 2));
  const [error, setError] = useState(null);

  const save = () => {
    try {
      const parsed = JSON.parse(specText);
      dao.saveConverter({
        id: converter.id, key: converter.key, name,
        institution: converter.institution, account_type: converter.account_type,
        format: converter.format, spec_json: JSON.stringify(parsed),
        notes
      });
      onSaved();
    } catch (e) {
      setError('Invalid JSON: ' + e.message);
    }
  };

  return html`<${Modal}
    open=${true}
    onClose=${onClose}
    title=${`Converter: ${converter.name}`}
    size="lg"
    footer=${html`<${Fragment}>
      <${Button} variant="ghost" onClick=${onClose}>Close</${Button}>
      <${Button} onClick=${save}>Save</${Button}>
    </${Fragment}>`}
  >
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <${Label}>Name</${Label}>
          <${Input} value=${name} onChange=${e => setName(e.target.value)} />
        </div>
        <div>
          <${Label}>Institution / Format</${Label}>
          <${Input} value=${`${converter.institution} · ${converter.format.toUpperCase()}`} disabled />
        </div>
      </div>
      <div>
        <${Label}>Notes</${Label}>
        <${Input} value=${notes} onChange=${e => setNotes(e.target.value)} placeholder="Notes about this format…" />
      </div>
      <div>
        <${Label}>Spec (JSON)</${Label}>
        <textarea
          value=${specText}
          onChange=${e => setSpecText(e.target.value)}
          class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          rows="20"
        ></textarea>
      </div>
      ${error && html`<div class="text-sm text-red-600">${error}</div>`}
    </div>
  </${Modal}>`;
}

