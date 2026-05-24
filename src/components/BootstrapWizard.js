import html from '../html.js';
import { useState, useEffect, useRef, Fragment } from '../react.js';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, KNOWN_INSTITUTIONS } from '../constants.js';
import { formatMoney, classNames, uid, getCurrency } from '../utils.js';
import { dao } from '../db/store.js';
import { readFileForParse, applyConverter } from '../engine/converter.js';
import { suggestCSVSpec, suggestPDFSpec } from '../engine/bootstrap.js';
import { pdfToText, pdfToRows } from '../engine/converter.js';
import { callLLM, getLLMConfig, setLLMConfig, LLM_PROVIDERS, LLM_KEY_STORAGE, normalizeWizardSpec } from '../llm/adapter.js';
import { TXN_TYPE_LABEL } from '../constants.js';
import { Button, Card, Modal, Label, Input, Select, HelpLink } from './ui/index.js';

export function BootstrapWizard({ open, onClose, file, format, previewText, defaults, onSaved }) {
  const [stage, setStage] = useState('analyzing');
  const [spec, setSpec] = useState(null);
  const [meta, setMeta] = useState({
    name: '',
    institution: defaults?.institution || '',
    account_type: defaults?.accountType || '',
    default_account: defaults?.accountName || '',
    notes: ''
  });
  const [csvContext, setCsvContext] = useState(null);

  useEffect(() => {
    if (!open || !file) return;
    setStage('analyzing');
    (async () => {
      try {
        if (format === 'csv') {
          const text = await file.text();
          const sug = suggestCSVSpec(text);
          if (sug) {
            setSpec(sug.spec);
            setCsvContext({ headers: sug.headers, sample: sug.sample });
            setMeta(m => ({
              ...m,
              name: m.institution ? `${m.institution} (CSV)` : 'New CSV Converter',
              account_type: m.account_type || sug.spec.account_type,
              default_account: m.default_account || ''
            }));
          } else {
            setSpec({
              type: 'csv', has_header: true, delimiter: ',',
              columns: { transaction_date: 'Date', description: 'Description', amount: 'Amount' },
              date_format: 'auto', amount_handling: 'single_signed', amount_sign: 'natural',
              account_type: 'chequing', default_account: '', default_currency: getCurrency()
            });
          }
          setStage('csv-editor');
        } else if (format === 'pdf') {
          const buf = await file.arrayBuffer();
          const text = await pdfToText(new Uint8Array(buf));
          const sug = suggestPDFSpec(text);
          if (sug) {
            setSpec(sug.spec);
            setMeta(m => ({ ...m, name: m.institution ? `${m.institution} (PDF)` : 'New PDF Converter' }));
          } else {
            setSpec({
              type: 'pdf',
              line_regex: '^(\\d{1,2}/\\d{1,2})\\s+(.+?)\\s+\\$?(-?[\\d,]+\\.\\d{2})$',
              groups: { transaction_date: 1, description: 2, amount: 3 },
              date_format: 'MM/DD',
              year: new Date().getFullYear(),
              amount_handling: 'single_signed', amount_sign: 'natural',
              account_type: 'credit_card', default_account: '', default_currency: getCurrency()
            });
          }
          setStage('pdf-editor');
        }
      } catch (e) {
        console.error(e);
        setStage('error');
      }
    })();
  }, [open, file, format]);

  const save = () => {
    if (!spec || !meta.institution || !meta.name) return;
    const finalSpec = {
      ...spec,
      account_type: meta.account_type || spec.account_type,
      default_account: meta.default_account || spec.default_account,
      institution: meta.institution
    };
    const key = `${meta.institution}_${format}_${uid().slice(0, 4)}`.toLowerCase().replace(/\s+/g, '_');
    const id = dao.saveConverter({
      key, name: meta.name, institution: meta.institution,
      account_type: meta.account_type, format,
      spec_json: JSON.stringify(finalSpec), notes: meta.notes
    });
    onSaved(dao.getConverter(id));
  };

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title=${`Bootstrap a new ${format === 'pdf' ? 'PDF' : 'CSV'} converter`}
    size="xl"
    footer=${html`<${Fragment}>
      <${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}>
      <${Button} onClick=${save} disabled=${!spec || !meta.institution || !meta.name}>
        Save converter & parse
      </${Button}>
    </${Fragment}>`}
  >
    <div class="text-sm text-ink-2 mb-4">
      We've analyzed the document and proposed a converter. Review the mapping, tweak as needed, then save. This converter will be reused automatically for all future uploads from this institution.
    </div>

    <${ConverterMetaForm} meta=${meta} setMeta=${setMeta} />

    ${stage === 'analyzing' && html`<div class="mt-6 text-sm text-ink-mute">Analyzing document…</div>`}
    ${stage === 'error' && html`<div class="mt-6 text-sm text-plum">Could not analyze this document. Try a different format or set the spec manually.</div>`}

    ${stage === 'csv-editor' && spec && html`<${CSVConverterEditor} spec=${spec} setSpec=${setSpec} ctx=${csvContext} />`}
    ${stage === 'pdf-editor' && spec && html`<${PDFConverterEditor} spec=${spec} setSpec=${setSpec} previewText=${previewText} />`}

    ${spec && html`<div class="mt-6">
      <${Label}>Live preview (first 5 transactions)</${Label}>
      <${LivePreview} file=${file} spec=${spec} format=${format} />
    </div>`}
  </${Modal}>`;
}

export function ConverterMetaForm({ meta, setMeta }) {
  return html`<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
    <div>
      <${Label}>Converter name *</${Label}>
      <${Input} value=${meta.name} onChange=${e => setMeta({ ...meta, name: e.target.value })} placeholder="TD Visa CSV v2" />
    </div>
    <div>
      <${Label}>Institution *</${Label}>
      <${InstitutionPicker} value=${meta.institution} onChange=${v => setMeta({ ...meta, institution: v })} />
    </div>
    <div>
      <${Label}>Account type</${Label}>
      <${Select} value=${meta.account_type} onChange=${e => setMeta({ ...meta, account_type: e.target.value })}>
        <option value="">—</option>
        ${ACCOUNT_TYPES.map(t => html`<option key=${t} value=${t}>${ACCOUNT_TYPE_LABEL[t]}</option>`)}
      </${Select}>
    </div>
    <div>
      <${Label}>Default account name</${Label}>
      <${Input} value=${meta.default_account} onChange=${e => setMeta({ ...meta, default_account: e.target.value })} placeholder="TD Visa" />
    </div>
  </div>`;
}

export function InstitutionPicker({ value, onChange }) {
  const [custom, setCustom] = useState(false);
  return html`<div class="grid grid-cols-2 gap-2">
    ${!custom ? html`<${Select} value=${value || ''} onChange=${e => {
      if (e.target.value === '__custom__') { setCustom(true); onChange(''); }
      else onChange(e.target.value);
    }}>
      <option value="">Select institution…</option>
      ${KNOWN_INSTITUTIONS.map(i => html`<option key=${i} value=${i}>${i}</option>`)}
      <option value="__custom__">+ Add new…</option>
    </${Select}>` : html`<${Input}
      autoFocus
      placeholder="Institution name"
      value=${value || ''}
      onChange=${e => onChange(e.target.value)}
      onBlur=${() => { if (!value) setCustom(false); }}
    />`}
  </div>`;
}

function CSVConverterEditor({ spec, setSpec, ctx }) {
  const headerOptions = ctx?.headers || [];
  const set = (path, value) => {
    setSpec(s => {
      const next = { ...s };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const columnPicker = (label, key, optional = false) => html`<div>
    <${Label}>${label}${!optional && ' *'}</${Label}>
    ${headerOptions.length > 0 ? html`<${Select} value=${spec.columns[key] ?? ''} onChange=${e => set(`columns.${key}`, e.target.value || null)}>
      <option value="">—</option>
      ${headerOptions.map(h => html`<option key=${h} value=${h}>${h}</option>`)}
    </${Select}>` : html`<${Input}
      type="number"
      value=${spec.columns[key] ?? ''}
      onChange=${e => set(`columns.${key}`, e.target.value === '' ? null : parseInt(e.target.value, 10))}
      placeholder="Column index (0-based)"
    />`}
  </div>`;

  return html`<div class="mt-6 space-y-4">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <${Label}>Delimiter</${Label}>
        <${Select} value=${spec.delimiter} onChange=${e => set('delimiter', e.target.value)}>
          <option value=",">Comma (,)</option>
          <option value=";">Semicolon (;)</option>
          <option value=${'\t'}>Tab</option>
          <option value="|">Pipe (|)</option>
        </${Select}>
      </div>
      <div>
        <${Label}>Has header row?</${Label}>
        <${Select} value=${spec.has_header ? '1' : '0'} onChange=${e => set('has_header', e.target.value === '1')}>
          <option value="1">Yes</option>
          <option value="0">No</option>
        </${Select}>
      </div>
      <div>
        <${Label}>Date format</${Label}>
        <${Select} value=${spec.date_format} onChange=${e => set('date_format', e.target.value)}>
          <option value="auto">Auto-detect</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="M/D/YYYY">M/D/YYYY</option>
          <option value="MM-DD-YYYY">MM-DD-YYYY</option>
        </${Select}>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      ${columnPicker('Transaction date', 'transaction_date')}
      ${columnPicker('Posted date', 'posted_date', true)}
      ${columnPicker('Description', 'description')}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <${Label}>Amount handling</${Label}>
        <${Select} value=${spec.amount_handling} onChange=${e => set('amount_handling', e.target.value)}>
          <option value="single_signed">Single signed column</option>
          <option value="split_debit_credit">Split debit / credit columns</option>
        </${Select}>
      </div>
      ${spec.amount_handling === 'single_signed'
        ? columnPicker('Amount', 'amount')
        : html`<${Fragment}>${columnPicker('Debit (out)', 'debit')}${columnPicker('Credit (in)', 'credit')}</${Fragment}>`
      }
      <div>
        <${Label}>Sign convention</${Label}>
        <${Select} value=${spec.amount_sign} onChange=${e => set('amount_sign', e.target.value)}>
          <option value="natural">Natural (negative = expense)</option>
          <option value="flipped">Flipped (positive = expense, e.g. credit cards)</option>
        </${Select}>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      ${columnPicker('Merchant (optional)', 'merchant', true)}
      ${columnPicker('Category (optional)', 'category', true)}
      <div>
        <${Label}>Default currency</${Label}>
        <${Input} value=${spec.default_currency} onChange=${e => set('default_currency', e.target.value.toUpperCase())} />
      </div>
    </div>
  </div>`;
}

function PDFConverterEditor({ spec, setSpec, previewText }) {
  const set = (path, value) => {
    setSpec(s => {
      const next = { ...s };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };
  return html`<div class="mt-6 space-y-4">
    <div>
      <${Label}>Line regex</${Label}>
      <${Input}
        className="font-mono text-xs"
        value=${spec.line_regex}
        onChange=${e => set('line_regex', e.target.value)}
      />
      <p class="text-xs text-ink-mute mt-1">Should match a single transaction line. Use capture groups for date / description / amount.</p>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div>
        <${Label}>Date group #</${Label}>
        <${Input} type="number" value=${spec.groups.transaction_date} onChange=${e => set('groups.transaction_date', parseInt(e.target.value, 10))} />
      </div>
      <div>
        <${Label}>Posted date group #</${Label}>
        <${Input} type="number" value=${spec.groups.posted_date || ''} onChange=${e => set('groups.posted_date', e.target.value ? parseInt(e.target.value, 10) : null)} />
      </div>
      <div>
        <${Label}>Description group #</${Label}>
        <${Input} type="number" value=${spec.groups.description} onChange=${e => set('groups.description', parseInt(e.target.value, 10))} />
      </div>
      <div>
        <${Label}>Amount group #</${Label}>
        <${Input} type="number" value=${spec.groups.amount} onChange=${e => set('groups.amount', parseInt(e.target.value, 10))} />
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <${Label}>Date format</${Label}>
        <${Select} value=${spec.date_format} onChange=${e => set('date_format', e.target.value)}>
          <option value="MM/DD">MM/DD (year inferred)</option>
          <option value="DD/MM">DD/MM (year inferred)</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="auto">Auto</option>
        </${Select}>
      </div>
      <div>
        <${Label}>Statement year (for MM/DD)</${Label}>
        <${Input} type="number" value=${spec.year} onChange=${e => set('year', parseInt(e.target.value, 10))} />
      </div>
      <div>
        <${Label}>Sign convention</${Label}>
        <${Select} value=${spec.amount_sign} onChange=${e => set('amount_sign', e.target.value)}>
          <option value="natural">Natural</option>
          <option value="flipped">Flipped (credit card)</option>
        </${Select}>
      </div>
    </div>
    <details>
      <summary class="text-xs text-maple-deep hover:underline cursor-pointer">Show extracted text</summary>
      <pre class="mt-2 text-xs bg-paper border border-rule rounded p-3 max-h-48 overflow-auto scrollbar-thin font-mono whitespace-pre-wrap">${previewText || ''}</pre>
    </details>
  </div>`;
}

export function LivePreview({ file, spec, format }) {
  const [preview, setPreview] = useState({ rows: [], err: null });
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const raw = await readFileForParse(file, format);
        const result = await applyConverter(file, raw, spec, {});
        if (!cancel) setPreview({ rows: result.transactions.slice(0, 5), err: null, total: result.transactions.length });
      } catch (e) {
        if (!cancel) setPreview({ rows: [], err: e.message });
      }
    })();
    return () => { cancel = true; };
  }, [file, JSON.stringify(spec), format]);

  if (preview.err) return html`<div class="text-sm text-plum">${preview.err}</div>`;
  if (preview.rows.length === 0) return html`<div class="text-sm text-ink-mute">No transactions matched yet. Adjust the spec above.</div>`;

  return html`<div>
    <div class="text-xs text-ink-mute mb-2">Showing 5 of ${preview.total}.</div>
    <div class="border border-rule rounded-lg overflow-hidden">
      <table class="w-full text-xs">
        <thead class="bg-paper text-ink-2">
          <tr>
            <th class="text-left px-3 py-2">Date</th>
            <th class="text-left px-3 py-2">Description</th>
            <th class="text-right px-3 py-2">Amount</th>
            <th class="text-left px-3 py-2">Type</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-rule">
          ${preview.rows.map((t, i) => html`<tr key=${i}>
            <td class="px-3 py-2 font-mono">${t.transaction_date}</td>
            <td class="px-3 py-2 truncate max-w-[400px]">${t.description}</td>
            <td class=${classNames('px-3 py-2 text-right font-mono', t.signed_amount < 0 ? 'text-plum' : 'text-forest')}>
              ${formatMoney(t.signed_amount)}
            </td>
            <td class="px-3 py-2">${TXN_TYPE_LABEL[t.transaction_type]}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

export function APIKeyModal({ open, onClose, onSaved }) {
  const [provider, setProvider] = useState('anthropic');
  const [key, setKey] = useState('');
  useEffect(() => {
    if (!open) return;
    const c = getLLMConfig();
    setProvider(c.provider);
    setKey(localStorage.getItem(LLM_KEY_STORAGE[c.provider]) || '');
  }, [open]);
  const onProvider = (p) => { setProvider(p); setKey(localStorage.getItem(LLM_KEY_STORAGE[p]) || ''); };
  const save = () => { setLLMConfig({ provider, apiKey: key }); onSaved && onSaved(); };
  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="Connect an AI model"
    size="md"
    footer=${html`<${Fragment}>
      <${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}>
      <${Button} onClick=${save} disabled=${!key.trim()}>Save key</${Button}>
    </${Fragment}>`}
  >
    <p class="text-sm text-ink-2 mb-4">
      The AI only writes the parser spec — it never sees your transactions, which are parsed locally. Bring your own API key from either provider.
    </p>
    <div class="space-y-3">
      <div>
        <${Label}>Provider</${Label}>
        <${Select} value=${provider} onChange=${e => onProvider(e.target.value)}>
          ${Object.entries(LLM_PROVIDERS).map(([id, p]) => html`<option key=${id} value=${id}>${p.label}</option>`)}
        </${Select}>
      </div>
      <div>
        <${Label}>API key</${Label}>
        <${Input} type="password" value=${key} onChange=${e => setKey(e.target.value)} placeholder=${provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} autoComplete="off" />
        <p class="text-xs text-ink-mute mt-1">
          Default model: <span class="font-mono">${LLM_PROVIDERS[provider]?.defaultModel}</span>.${' '}
          <a href=${LLM_PROVIDERS[provider]?.keyUrl} target="_blank" rel="noreferrer" class="text-maple-deep hover:underline">Get a key →</a>
        </p>
      </div>
      <div class="rounded-lg bg-butter-soft border border-butter-line p-3 text-xs text-butter-deep">
        The key is stored only in this browser's local storage and sent directly to ${LLM_PROVIDERS[provider]?.label}. It is excluded from DB exports. Because this page loads libraries from CDNs, treat the key as exposed to this page — use a key you can rotate.
      </div>
    </div>
  </${Modal}>`;
}

export function AIConverterWizard({ open, onClose, file, format, defaults, onSaved }) {
  const [stage, setStage] = useState('notice');
  const [messages, setMessages] = useState([]);
  const [spec, setSpec] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState(null);
  const [input, setInput] = useState('');
  const [meta, setMeta] = useState({
    name: '', institution: defaults?.institution || '', account_type: defaults?.accountType || '',
    default_account: defaults?.accountName || '', notes: ''
  });
  const scrollRef = useRef(null);
  const cfg = getLLMConfig();

  useEffect(() => {
    if (!open || !file) return;
    setMessages([]); setSpec(null); setParseResult(null); setFatal(null); setInput('');
    setMeta(m => ({ ...m, name: defaults?.institution ? `${defaults.institution} (${(format || '').toUpperCase()}, AI)` : `New ${(format || '').toUpperCase()} converter` }));
    setStage('notice');
  }, [open, file]);

  function handleNoticeConfirmed() {
    const conf = getLLMConfig();
    if (!conf.apiKey) { setStage('key'); return; }
    startAnalysis();
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  async function extractDocContext() {
    if (format === 'csv' || format === 'unknown') {
      const text = await file.text();
      return text.split(/\r?\n/).slice(0, 60).join('\n').slice(0, 6000);
    }
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const text = await pdfToText(u8);
    let ctx = text.slice(0, 5000);
    try {
      const rows = await pdfToRows(u8);
      const sample = rows.slice(0, 45).map(r =>
        'y=' + r.y + ' | ' + r.items.map(it => `[x=${Math.round(it.x)}]${it.str}`).join(' ')
      ).join('\n').slice(0, 4000);
      ctx += '\n\n--- ITEM X-COORDINATES (first rows; use these to set x_min/x_max for layout:"columns") ---\n' + sample;
    } catch (_) {}
    return ctx;
  }

  function buildApiMessages(list) {
    return list.filter(m => m.role !== 'note').map(m => {
      if (m.role === 'assistant') {
        return { role: 'assistant', content: (m.text || '') + (m.spec ? '\n\nProposed spec:\n```json\n' + JSON.stringify(m.spec) + '\n```' : '') };
      }
      return { role: 'user', content: m.text };
    });
  }

  async function validate(s) {
    try {
      const raw = await readFileForParse(file, format);
      const result = await applyConverter(file, raw, s, {});
      return { rows: result.transactions, errors: result.errors || [], error: null };
    } catch (e) {
      return { rows: [], errors: [], error: e.message };
    }
  }

  function summarize(pr) {
    if (!pr) return 'No parse run yet.';
    if (pr.error) return 'The engine threw an error: ' + pr.error;
    const out = [`Parsed ${pr.rows.length} transaction(s); ${pr.errors.length} warning(s).`];
    if (pr.errors.length) out.push('Warnings:\n' + pr.errors.slice(0, 10).map(e => e.row ? `Row ${e.row}: ${e.error}` : e.error).join('\n'));
    if (pr.rows.length) out.push('Sample parsed rows:\n' + pr.rows.slice(0, 4).map(t => `${t.transaction_date} | ${t.description} | ${formatMoney(t.signed_amount)} | ${t.transaction_type}`).join('\n'));
    return out.join('\n');
  }

  async function callModel(list) {
    const conf = getLLMConfig();
    const { spec: newSpec, text } = await callLLM({ provider: conf.provider, apiKey: conf.apiKey, model: conf.model, messages: buildApiMessages(list) });
    return { newSpec: normalizeWizardSpec(newSpec), text };
  }

  async function startAnalysis() {
    setStage('analyzing'); setBusy(true); setFatal(null);
    try {
      const ctx = await extractDocContext();
      const firstText = `Document type: ${(format || '').toUpperCase()}\nFilename: ${file.name}\n\nDocument excerpt:\n---\n${ctx}\n---\n\nAnalyze this statement and produce a converter spec.`;
      let list = [{ role: 'user', text: firstText, display: `Analyze ${file.name}` }];
      setMessages(list); setStage('chat');
      let { newSpec, text } = await callModel(list);
      let pr = await validate(newSpec);
      list = [...list, { role: 'assistant', text, spec: newSpec }];
      setMessages(list); setSpec(newSpec); setParseResult(pr);
      for (let i = 0; i < 2; i++) {
        const clean = !pr.error && pr.rows.length > 0 && pr.errors.length === 0;
        if (clean) break;
        const autoText = 'Automatic validation result:\n' + summarize(pr) + '\n\nPlease correct the spec so all transaction rows parse cleanly.';
        list = [...list, { role: 'auto', text: autoText, display: `Auto-check: ${pr.error ? 'engine error' : pr.errors.length + ' warning(s)'} — asking the model to fix` }];
        setMessages(list);
        const r = await callModel(list);
        newSpec = r.newSpec;
        pr = await validate(newSpec);
        list = [...list, { role: 'assistant', text: r.text, spec: newSpec }];
        setMessages(list); setSpec(newSpec); setParseResult(pr);
      }
    } catch (e) {
      console.error(e);
      setFatal(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput(''); setBusy(true); setFatal(null);
    try {
      const userText = text + '\n\nFor reference, the current parse result is:\n' + summarize(parseResult);
      let list = [...messages, { role: 'user', text: userText, display: text }];
      setMessages(list);
      const { newSpec, text: expl } = await callModel(list);
      const pr = await validate(newSpec);
      list = [...list, { role: 'assistant', text: expl, spec: newSpec }];
      setMessages(list); setSpec(newSpec); setParseResult(pr);
    } catch (e) {
      console.error(e);
      setFatal(e.message);
    } finally {
      setBusy(false);
    }
  }

  function doSave() {
    if (!spec || !meta.institution || !meta.name) return;
    const finalSpec = normalizeWizardSpec({
      ...spec,
      account_type: meta.account_type || spec.account_type,
      default_account: meta.default_account || spec.default_account,
      institution: meta.institution,
    });
    const key = `${meta.institution}_${format}_${uid().slice(0, 4)}`.toLowerCase().replace(/\s+/g, '_');
    const id = dao.saveConverter({
      key, name: meta.name, institution: meta.institution,
      account_type: meta.account_type, format,
      spec_json: JSON.stringify(finalSpec), notes: meta.notes,
    });
    onSaved(dao.getConverter(id));
  }

  if (!open) return null;

  if (stage === 'notice') {
    return html`<${Modal} open=${open} onClose=${onClose} title="Set up a converter with AI"
      footer=${html`<${Fragment}><${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} onClick=${handleNoticeConfirmed}>Got it, proceed</${Button}></${Fragment}>`}>
      <div class="space-y-4 max-w-xl">
        <div class="rounded-lg bg-butter-soft border border-butter-line p-4 text-sm text-butter-deep">
          <p class="font-semibold mb-2">Consider removing personal information first</p>
          <p class="mb-3 text-butter-deep">
            The wizard will send a portion of your document to an AI model to learn its format.
            The AI only needs to see the structure — not your actual data.
          </p>
          <p class="font-medium mb-1">Consider redacting:</p>
          <ul class="list-disc list-inside space-y-1 text-butter-deep mb-3">
            <li>Your name and address</li>
            <li>Full account numbers (keeping the last 4 digits is fine)</li>
            <li>Exact balances (replace with $0.00)</li>
            <li>Any other personal identifiers in the header</li>
          </ul>
          <p class="text-butter-deep">
            <span class="font-medium">Tip:</span> 5–10 representative rows are enough — you can truncate the rest.
            Dates, merchant names, and amounts can stay; they help the AI understand the format.
          </p>
        </div>
        <div class="text-xs text-ink-mute">
          Want the full picture first? <${HelpLink} anchor="ai-converters" label="Read how AI converter setup works" />
        </div>
      </div>
    </${Modal}>`;
  }

  if (stage === 'key') {
    return html`<${APIKeyModal} open=${true} onClose=${onClose} onSaved=${() => startAnalysis()} />`;
  }

  const parsedCount = parseResult?.rows?.length || 0;
  const warnCount = parseResult?.errors?.length || 0;
  const canSave = !!spec && !!meta.name && !!meta.institution && parsedCount > 0;

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="Set up a converter with AI"
    size="xl"
    footer=${html`<${Fragment}>
      <div class="mr-auto text-xs text-ink-mute self-center">
        Using ${LLM_PROVIDERS[cfg.provider]?.label} · <span class="font-mono">${cfg.model}</span> ·${' '}
        <button class="text-maple-deep hover:underline" onClick=${() => setStage('key')}>change key</button>
      </div>
      <${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}>
      <${Button} onClick=${doSave} disabled=${!canSave}>Save converter & parse</${Button}>
    </${Fragment}>`}
  >
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="flex flex-col border border-rule rounded-lg overflow-hidden h-[58vh]">
        <div ref=${scrollRef} class="flex-1 overflow-auto scrollbar-thin p-3 space-y-3 bg-paper">
          ${messages.map((m, i) => {
            if (m.role === 'auto' || m.role === 'note') {
              return html`<div key=${i} class="text-center"><span class="inline-block text-[11px] text-butter-deep bg-butter-soft border border-butter-line rounded-full px-3 py-1">${m.display || m.text}</span></div>`;
            }
            const isUser = m.role === 'user';
            return html`<div key=${i} class=${classNames('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div class=${classNames('max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', isUser ? 'bg-maple text-ink' : 'bg-paper-2 border border-rule text-ink')}>
                ${m.display || m.text}
              </div>
            </div>`;
          })}
          ${busy && html`<div class="text-xs text-ink-mute px-1">Thinking…</div>`}
          ${fatal && html`<div class="text-xs text-plum bg-plum-soft border border-plum-line rounded p-2">${fatal}</div>`}
        </div>
        <div class="border-t border-rule p-2 flex gap-2 bg-paper-2">
          <${Input}
            value=${input}
            onChange=${e => setInput(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="e.g. the dates are off by a month, or amounts should be flipped"
            disabled=${busy}
          />
          <${Button} onClick=${send} disabled=${busy || !input.trim()}>Send</${Button}>
        </div>
      </div>

      <div class="space-y-3">
        <${ConverterMetaForm} meta=${meta} setMeta=${setMeta} />
        <div class="flex items-center gap-2 text-xs">
          ${parseResult ? (
            parseResult.error
              ? html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-plum-soft text-plum-deep">Engine error</span>`
              : html`<${Fragment}>
                  <span class=${`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${parsedCount > 0 ? 'bg-paper-3 text-forest' : 'bg-paper-3 text-ink-2'}`}>${parsedCount} parsed</span>
                  <span class=${`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${warnCount > 0 ? 'bg-butter-soft text-butter-deep' : 'bg-paper-3 text-ink-2'}`}>${warnCount} warning(s)</span>
                </${Fragment}>`
          ) : html`<span class="text-ink-mute">Waiting for first result…</span>`}
        </div>
        ${spec
          ? html`<${LivePreview} file=${file} spec=${spec} format=${format} />`
          : html`<div class="text-sm text-ink-mute">The proposed converter and a live transaction preview will appear here.</div>`}
      </div>
    </div>
  </${Modal}>`;
}
