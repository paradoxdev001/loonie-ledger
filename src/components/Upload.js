import html from '../html.js';
import { useState, useEffect, useMemo, useRef } from '../react.js';
import { useApp } from '../state.js';
import { dao } from '../db/store.js';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL } from '../constants.js';
import { classNames, fingerprint, formatBatchSummary } from '../utils.js';
import { detectFormat, readFileForParse, applyConverter, pdfToText } from '../engine/converter.js';
import { autoCategorize, extractMerchant } from '../engine/categorizer.js';
import { Button, Card, CardHeader, Badge, Label, Input, Select, HelpLink } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';
import { BootstrapWizard, AIConverterWizard, InstitutionPicker } from './BootstrapWizard.js';

function normalizeFilenameForMatch(name) {
  return String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g, '')
    .replace(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g, '')
    .replace(/\d{4}[-\/]\d{1,2}/g, '')
    .replace(/(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)/gi, '')
    .replace(/\d{4,}/g, '')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .toLowerCase();
}

function findReuseHint(filename) {
  const docs = dao.listDocuments();
  if (!docs.length || !filename) return null;
  let match = docs.find(d => d.filename === filename && d.converter_id);
  if (!match) {
    const target = normalizeFilenameForMatch(filename);
    if (target) match = docs.find(d => d.converter_id && normalizeFilenameForMatch(d.filename) === target);
  }
  if (!match) return null;
  const converter = dao.getConverter(match.converter_id);
  if (!converter) return null;
  const account = match.account_id ? dao.listAccounts().find(a => a.id === match.account_id) : null;
  return { doc: match, converter, account };
}

async function parseFileWithConverter(file, converter, { institution = '', accountType = '', accountName = '' } = {}) {
  const spec = JSON.parse(converter.spec_json);
  const raw = await readFileForParse(file, converter.format);
  const acctName = accountName || spec.default_account || `${institution} ${spec.account_type || ''}`.trim();
  const resolvedInstitution = institution || spec.institution || '';
  const account_id = dao.upsertAccount({
    institution: resolvedInstitution,
    account_name: acctName,
    account_type: accountType || spec.account_type,
    currency: spec.default_currency || 'CAD'
  });
  const document_id = dao.insertDocument({
    filename: file.name, format: converter.format,
    institution: resolvedInstitution, account_id, converter_id: converter.id,
    status: 'parsing', raw_size: file.size
  });
  const result = await applyConverter(file, raw, spec, {
    institution: resolvedInstitution, account_name: acctName, statement_year: new Date().getFullYear()
  });
  const userRules = dao.listCategoryRules();
  const enriched = await Promise.all(result.transactions.map(async t => ({
    ...t,
    merchant: t.merchant || extractMerchant(t.description),
    category: t.category || autoCategorize(t, userRules),
    is_excluded: false,
    document_id, account_id,
    fingerprint: await fingerprint([t.transaction_date, t.amount, t.transaction_type, t.description, acctName])
  })));
  let duplicateCount = 0;
  enriched.forEach(t => {
    if (dao.isDuplicate(account_id, t.fingerprint)) {
      t._duplicate = true;
      duplicateCount++;
    }
  });
  dao.updateDocumentStatus(document_id, 'parsed');
  return {
    document_id,
    account_id,
    account_name: acctName,
    institution: resolvedInstitution,
    converter,
    transactions: enriched,
    errors: result.errors,
    duplicateCount
  };
}

function DropZone({ onFiles, multiple = false }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  return html`<div
    onDragOver=${e => { e.preventDefault(); setDrag(true); }}
    onDragLeave=${() => setDrag(false)}
    onDrop=${e => {
      e.preventDefault(); setDrag(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(multiple ? files : [files[0]]);
    }}
    onClick=${() => inputRef.current?.click()}
    class=${classNames(
      'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
      drag ? 'border-brand-500 bg-paper-3' : 'border-rule bg-paper hover:bg-paper-3'
    )}
  >
    <div class="text-4xl mb-3">📄</div>
    <div class="font-medium text-ink">Drop a file here or click to browse</div>
    <div class="text-xs text-ink-mute mt-1">Supports CSV and PDF. Bank statements, credit-card statements, exports.</div>
    <input
      ref=${inputRef}
      type="file"
      multiple=${multiple}
      accept=".csv,.tsv,.pdf,.txt"
      class="hidden"
      onChange=${e => {
        const files = Array.from(e.target.files || []);
        if (files.length) onFiles(multiple ? files : [files[0]]);
        e.target.value = '';
      }}
    />
  </div>`;
}

function ConverterMatchPanel({ file, format, institution, accountType, onConverterChosen, onNeedConverter, onNeedAIConverter }) {
  const candidates = useMemo(() => {
    if (!institution || !format) return [];
    return dao.findConverters({ institution, format });
  }, [institution, format]);

  const exact = candidates.filter(c => !accountType || c.account_type === accountType);
  const list = exact.length ? exact : candidates;

  if (!institution || !format) {
    return html`<div class="text-sm text-ink-mute">Pick an institution to see matching converters.</div>`;
  }
  if (list.length === 0) {
    return html`<div class="rounded-lg bg-butter-soft border border-butter-line p-4">
      <div class="text-sm font-medium text-butter-deep">No converter exists for ${institution} (${format.toUpperCase()})</div>
      <p class="text-xs text-butter-deep mt-1">
        Let AI analyze the file and build a reusable converter for you, or set one up manually. Once saved, future uploads from ${institution} will skip this step.
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <${Button} onClick=${onNeedAIConverter}>✨ Set up with AI</${Button}>
        <${Button} variant="secondary" onClick=${onNeedConverter}>Bootstrap manually</${Button}>
        <${HelpLink} anchor="ai-converters" label="How does this work?" />
      </div>
    </div>`;
  }
  return html`<div class="space-y-2">
    <div class="text-xs text-ink-mute">Choose a converter for this document:</div>
    ${list.map(c => html`<button
      key=${c.id}
      onClick=${() => onConverterChosen(c)}
      class="w-full text-left rounded-lg border border-rule hover:border-brand-500 hover:bg-paper-3 p-3 transition-colors"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-sm font-medium text-ink">${c.name}</div>
          <div class="text-xs text-ink-mute mt-0.5">${c.institution} · ${c.format.toUpperCase()} · ${ACCOUNT_TYPE_LABEL[c.account_type] || 'Any'}</div>
        </div>
        ${c.is_builtin ? html`<${Badge} color="blue">Built-in</${Badge}>` : html`<${Badge} color="violet">Custom</${Badge}>`}
      </div>
    </button>`)}
    <div class="text-xs text-ink-mute pt-1">
      None of these match?${' '}<button onClick=${onNeedAIConverter} class="text-maple-deep hover:underline">Set up with AI ✨</button>
      ${' '}or <button onClick=${onNeedConverter} class="text-maple-deep hover:underline">bootstrap manually →</button>
      ${' '}·${' '}<${HelpLink} anchor="ai-converters" />
    </div>
  </div>`;
}

export function UploadView() {
  const { state, dispatch } = useApp();
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState(null);
  const [previewText, setPreviewText] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountType, setAccountType] = useState('');
  const [accountName, setAccountName] = useState('');
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [aiWizardOpen, setAiWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const [reuseHint, setReuseHint] = useState(null);

  useEffect(() => { setRecent(dao.listDocuments().slice(0, 8)); }, [state.refreshKey]);

  const handleFile = async (files) => {
    const f = files[0];
    setFile(f);
    const detectedFormat = detectFormat(f.name, await f.slice(0, 200).text().catch(() => ''));
    setFormat(detectedFormat);

    const hint = findReuseHint(f.name);
    if (hint && hint.converter.format === detectedFormat) {
      setReuseHint(hint);
      setInstitution(hint.doc.institution || hint.converter.institution || '');
      setAccountType(hint.account?.account_type || hint.converter.account_type || '');
      setAccountName(hint.account?.account_name || '');
    } else {
      setReuseHint(null);
      setAccountName('');
    }

    if (detectedFormat === 'csv' || detectedFormat === 'unknown') {
      const t = await f.text();
      setPreviewText(t.slice(0, 2000));
    } else if (detectedFormat === 'pdf') {
      try {
        const buf = await f.arrayBuffer();
        const text = await pdfToText(new Uint8Array(buf));
        setPreviewText(text.slice(0, 2000));
      } catch (e) {
        setPreviewText('(PDF preview failed: ' + e.message + ')');
      }
    }
  };

  const onConverterChosen = async (converter) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseFileWithConverter(file, converter, { institution, accountType, accountName });
      const { duplicateCount, ...payload } = parsed;
      dispatch({ type: 'SET_REVIEW', payload });
      dispatch({ type: 'TOAST', toast: { kind: 'success', message: `Parsed ${parsed.transactions.length} transactions` } });
    } catch (e) {
      console.error(e);
      dispatch({ type: 'TOAST', toast: { kind: 'error', message: 'Parse failed: ' + e.message } });
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (files) => {
    if (files.length === 1) {
      dispatch({ type: 'CLEAR_BATCH' });
      return handleFile(files);
    }
    dispatch({ type: 'CLEAR_BATCH' });
    setBusy(true);
    const stats = { total: files.length, autoImported: 0, queuedForReview: 0, skippedNoHint: 0, errors: 0, skippedNames: [] };
    const pendingForReview = [];
    for (const f of files) {
      try {
        const sniff = await f.slice(0, 200).text().catch(() => '');
        const detectedFormat = detectFormat(f.name, sniff);
        const hint = findReuseHint(f.name);
        if (!hint || hint.converter.format !== detectedFormat) {
          stats.skippedNoHint++;
          stats.skippedNames.push(f.name);
          continue;
        }
        const parsed = await parseFileWithConverter(f, hint.converter, {
          institution: hint.doc.institution || hint.converter.institution || '',
          accountType: hint.account?.account_type || hint.converter.account_type || '',
          accountName: hint.account?.account_name || ''
        });
        const clean = parsed.errors.length === 0 && parsed.duplicateCount === 0 && parsed.transactions.length > 0;
        if (clean) {
          const toInsert = parsed.transactions.map(t => ({
            document_id: parsed.document_id,
            account_id: parsed.account_id,
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
          dao.bulkInsertTransactions(toInsert);
          dao.updateDocumentStatus(parsed.document_id, 'imported');
          stats.autoImported++;
        } else {
          const { duplicateCount, ...parsedReview } = parsed;
          pendingForReview.push({ parsedReview });
          stats.queuedForReview++;
        }
      } catch (e) {
        console.error('batch parse error', f.name, e);
        stats.errors++;
      }
    }
    setBusy(false);
    if (pendingForReview.length > 0) {
      dispatch({ type: 'SET_BATCH', queue: pendingForReview.slice(1), stats });
      dispatch({ type: 'SET_REVIEW', payload: pendingForReview[0].parsedReview });
    } else {
      dispatch({ type: 'SET_BATCH', queue: [], stats });
      if (stats.autoImported > 0) dispatch({ type: 'REFRESH' });
      dispatch({ type: 'TOAST', toast: { kind: 'success', message: formatBatchSummary(stats) } });
    }
  };

  const showBatchSummary = state.batchStats && state.batchQueue.length === 0 && !state.pendingReview;

  return html`<${PageContainer}>
    <${PageHeader}
      title="Upload statement"
      description="Drop a CSV or PDF — drop several at once to auto-import recognized files in one shot. We'll detect the format, find a matching converter, and parse transactions deterministically."
    />

    ${showBatchSummary && html`<div class="mb-6 p-4 bg-paper-3 border border-rule rounded-lg">
      <div class="flex items-start justify-between gap-3">
        <div class="text-sm">
          <div class="font-medium text-forest">Batch upload complete</div>
          <div class="mt-1 text-forest">
            ${state.batchStats.autoImported > 0 && html`<span><span class="font-semibold">${state.batchStats.autoImported}</span> auto-imported</span>`}
            ${state.batchStats.autoImported > 0 && (state.batchStats.queuedForReview > 0 || state.batchStats.skippedNoHint > 0 || state.batchStats.errors > 0) && html`<span> · </span>`}
            ${state.batchStats.queuedForReview > 0 && html`<span><span class="font-semibold">${state.batchStats.queuedForReview}</span> reviewed</span>`}
            ${state.batchStats.queuedForReview > 0 && (state.batchStats.skippedNoHint > 0 || state.batchStats.errors > 0) && html`<span> · </span>`}
            ${state.batchStats.skippedNoHint > 0 && html`<span><span class="font-semibold">${state.batchStats.skippedNoHint}</span> unrecognized</span>`}
            ${state.batchStats.skippedNoHint > 0 && state.batchStats.errors > 0 && html`<span> · </span>`}
            ${state.batchStats.errors > 0 && html`<span><span class="font-semibold text-plum">${state.batchStats.errors}</span> failed</span>`}
          </div>
          ${state.batchStats.skippedNames?.length > 0 && html`<details class="mt-2 text-xs text-forest">
            <summary class="cursor-pointer hover:underline">Skipped files (drop individually to set up converter)</summary>
            <ul class="mt-1 ml-4 list-disc font-mono text-ink-2">
              ${state.batchStats.skippedNames.map(n => html`<li key=${n}>${n}</li>`)}
            </ul>
          </details>`}
        </div>
        <${Button} variant="ghost" size="sm" onClick=${() => dispatch({ type: 'CLEAR_BATCH' })}>Dismiss</${Button}>
      </div>
    </div>`}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        ${!file
          ? html`<${DropZone} onFiles=${handleFiles} multiple />`
          : html`<${Card}>
              <${CardHeader}
                title=${file.name}
                subtitle=${`${(file.size / 1024).toFixed(1)} KB · detected ${format?.toUpperCase() || '?'}`}
                right=${html`<${Button} variant="ghost" size="sm" onClick=${() => { setFile(null); setPreviewText(''); setReuseHint(null); }}>Change</${Button}>`}
              />
              <div class="p-5">
                <${Label}>Preview</${Label}>
                <pre class="mt-1 text-xs bg-paper border border-rule rounded p-3 max-h-48 overflow-auto scrollbar-thin font-mono whitespace-pre-wrap">${previewText || '(empty)'}</pre>
              </div>
            </${Card}>`}

        ${file && reuseHint && html`<${Card}>
          <div class="p-5 border-l-4 border-maple bg-paper-3 rounded-r-lg">
            <div class="text-sm font-medium text-forest">
              Matches a previous upload — reuse <span class="font-semibold">${reuseHint.converter.name}</span>?
            </div>
            <div class="text-xs text-forest mt-1">
              Filename matches <span class="font-mono">${reuseHint.doc.filename}</span>
              ${reuseHint.account ? html`<span> · account <span class="font-medium">${reuseHint.account.account_name}</span></span>` : null}
              ${reuseHint.doc.uploaded_at ? html`<span> · last used ${new Date(reuseHint.doc.uploaded_at).toLocaleDateString()}</span>` : null}
            </div>
            <div class="mt-3 flex gap-2">
              <${Button} onClick=${() => onConverterChosen(reuseHint.converter)} disabled=${busy}>
                Use ${reuseHint.converter.name} →
              </${Button}>
              <${Button} variant="ghost" onClick=${() => setReuseHint(null)}>
                Choose a different converter
              </${Button}>
            </div>
          </div>
        </${Card}>`}

        ${file && html`<${Card}>
          <${CardHeader} title="2. Choose a converter" subtitle="Match this document to an institution + format" />
          <div class="p-5 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <${Label}>Institution</${Label}>
                <${InstitutionPicker} value=${institution} onChange=${setInstitution} />
              </div>
              <div>
                <${Label}>Account type</${Label}>
                <${Select} value=${accountType} onChange=${e => setAccountType(e.target.value)}>
                  <option value="">Any</option>
                  ${ACCOUNT_TYPES.map(t => html`<option key=${t} value=${t}>${ACCOUNT_TYPE_LABEL[t]}</option>`)}
                </${Select}>
              </div>
              <div>
                <${Label}>Account name</${Label}>
                <${Input}
                  placeholder="e.g. TD Visa - Joint"
                  value=${accountName}
                  onChange=${e => setAccountName(e.target.value)}
                />
              </div>
            </div>
            <${ConverterMatchPanel}
              file=${file}
              format=${format}
              institution=${institution}
              accountType=${accountType}
              onConverterChosen=${onConverterChosen}
              onNeedConverter=${() => setBootstrapOpen(true)}
              onNeedAIConverter=${() => setAiWizardOpen(true)}
            />
          </div>
        </${Card}>`}
      </div>

      <div class="space-y-6">
        <${RecentUploads} recent=${recent} />
        <${BuiltInsCallout} />
      </div>
    </div>

    <${BootstrapWizard}
      open=${bootstrapOpen}
      onClose=${() => setBootstrapOpen(false)}
      file=${file}
      format=${format}
      previewText=${previewText}
      defaults=${{ institution, accountType, accountName }}
      onSaved=${converter => {
        setBootstrapOpen(false);
        dispatch({ type: 'TOAST', toast: { kind: 'success', message: `Saved converter "${converter.name}"` } });
        onConverterChosen(converter);
      }}
    />

    <${AIConverterWizard}
      open=${aiWizardOpen}
      onClose=${() => setAiWizardOpen(false)}
      file=${file}
      format=${format}
      defaults=${{ institution, accountType, accountName }}
      onSaved=${converter => {
        setAiWizardOpen(false);
        dispatch({ type: 'TOAST', toast: { kind: 'success', message: `Saved converter "${converter.name}"` } });
        onConverterChosen(converter);
      }}
    />

    ${busy && html`<div class="fixed inset-0 z-40 flex items-center justify-center" style=${{ background: 'rgba(22,24,31,0.45)' }}><div class="bg-paper-2 rounded-lg px-6 py-4 shadow-lg">Parsing…</div></div>`}
  </${PageContainer}>`;
}

function RecentUploads({ recent }) {
  return html`<${Card}>
    <${CardHeader} title="Recent uploads" />
    <div class="p-3">
      ${recent.length === 0
        ? html`<div class="text-xs text-ink-mute px-2 py-3">No uploads yet.</div>`
        : recent.map(d => html`<div key=${d.id} class="flex items-center justify-between py-2 px-2 hover:bg-paper rounded">
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">${d.filename}</div>
              <div class="text-xs text-ink-mute">
                ${d.institution || '—'} · ${d.account_name || '—'} · ${new Date(d.uploaded_at).toLocaleDateString()}
              </div>
            </div>
            <${Badge} color=${d.status === 'imported' ? 'green' : d.status === 'needs_converter' ? 'amber' : 'slate'}>
              ${d.status}
            </${Badge}>
          </div>`)}
    </div>
  </${Card}>`;
}

function BuiltInsCallout() {
  const list = useMemo(() => dao.listConverters().filter(c => c.is_builtin), []);
  return html`<${Card}>
    <${CardHeader} title="Built-in converters" subtitle=${`${list.length} ready to use`} />
    <div class="p-3 space-y-1">
      ${list.map(c => html`<div key=${c.id} class="text-xs px-2 py-1.5 rounded hover:bg-paper">
        <div class="font-medium text-ink">${c.name}</div>
        <div class="text-ink-mute">${c.institution} · ${c.format.toUpperCase()}</div>
      </div>`)}
    </div>
  </${Card}>`;
}
