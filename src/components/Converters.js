import html from '../html.js';
import { useState, useEffect, useRef, Fragment } from '../react.js';
import { useApp } from '../state.js';
import { dao, STORE } from '../db/store.js';
import { ACCOUNT_TYPE_LABEL } from '../constants.js';
import { downloadBlob, uid } from '../utils.js';
import { normalizeWizardSpec } from '../llm/adapter.js';
import { Button, Card, CardHeader, Badge, EmptyState, Modal, Label, Input } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

const CONVERTER_FILE_MARKER = 'loonie_ledger_converter';

// Build a portable, shareable JSON envelope for one converter. Blanks the
// recipient-specific account nickname; drops local/derived fields (id, is_builtin, …).
export function buildConverterFile(converter) {
  const spec = JSON.parse(converter.spec_json);
  spec.default_account = '';
  return JSON.stringify({
    [CONVERTER_FILE_MARKER]: 1,
    exported_at: new Date().toISOString(),
    converter: {
      key: converter.key,
      name: converter.name,
      institution: converter.institution,
      account_type: converter.account_type || null,
      format: converter.format,
      notes: converter.notes || null,
      spec,
    },
  }, null, 2);
}

// Parse + validate a shared converter file. Throws a clear Error on the wrong
// file type or missing fields. Returns fields ready for dao.saveConverter.
export function parseConverterFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('File is not valid JSON');
  }
  if (!parsed || parsed[CONVERTER_FILE_MARKER] == null || !parsed.converter) {
    throw new Error('Not a Loonie Ledger converter file');
  }
  const c = parsed.converter;
  if (!c.name || !c.institution || (c.format !== 'csv' && c.format !== 'pdf')) {
    throw new Error('Converter file is missing required fields');
  }
  if (!c.spec || typeof c.spec !== 'object' || !c.spec.type) {
    throw new Error('Converter file has an invalid spec');
  }
  return {
    name: c.name,
    institution: c.institution,
    account_type: c.account_type || null,
    format: c.format,
    notes: c.notes || null,
    spec: normalizeWizardSpec(c.spec),
  };
}

export function ConvertersView() {
  const { state, dispatch } = useApp();
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [usageCounts, setUsageCounts] = useState({});
  const fileRef = useRef(null);

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

  const onExport = (c) => {
    downloadBlob(buildConverterFile(c), `loonie-converter-${c.key}.json`, 'application/json');
    dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'Converter exported' } });
  };

  const onImport = async (file) => {
    if (!file) return;
    try {
      const { name, institution, account_type, format, notes, spec } = parseConverterFile(await file.text());
      const key = `${institution}_${format}_${uid().slice(0, 4)}`.toLowerCase().replace(/\s+/g, '_');
      dao.saveConverter({
        key, name, institution, account_type, format,
        spec_json: JSON.stringify(spec), notes, is_builtin: 0,
      });
      refresh();
      dispatch({ type: 'TOAST', toast: { kind: 'success', message: `Imported "${name}"` } });
    } catch (e) {
      dispatch({ type: 'TOAST', toast: { kind: 'error', message: 'Import failed: ' + e.message } });
    }
  };

  return html`<${PageContainer}>
    <${PageHeader}
      title="Converters"
      description="Each converter parses one institution's document format deterministically. Edit, export, or delete them — built-ins can be edited too."
    />

    <${Card}>
      <${CardHeader} title=${`${items.length} converters`} right=${html`<${Fragment}>
        <input ref=${fileRef} type="file" accept=".json" class="hidden"
          onChange=${e => { onImport(e.target.files[0]); e.target.value = ''; }} />
        <${Button} variant="secondary" size="sm" onClick=${() => fileRef.current?.click()}>Import converter</${Button}>
      </${Fragment}>`} />
      <${ConverterList} items=${items} usageCounts=${usageCounts} onView=${c => setEditing(c)} onExport=${onExport} onDelete=${onDelete} />
    </${Card}>

    ${editing && html`<${ConverterDetailModal}
      converter=${editing}
      onExport=${onExport}
      onClose=${() => setEditing(null)}
      onSaved=${() => { setEditing(null); refresh(); dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'Saved' } }); }}
    />`}
  </${PageContainer}>`;
}

function ConverterList({ items, usageCounts, onView, onExport, onDelete }) {
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
              <${Button} variant="ghost" size="sm" onClick=${() => onExport(c)}>Export</${Button}>
              <${Button} variant="ghost" size="sm" onClick=${() => onDelete(c)}>Delete</${Button}>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${items.length === 0 && html`<${EmptyState} icon="⚙" title="No converters yet" />`}
  </div>`;
}

function ConverterDetailModal({ converter, onClose, onSaved, onExport }) {
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
      <${Button} variant="ghost" onClick=${() => onExport(converter)}>Export</${Button}>
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

