// LocalRedact application. Wires the detection engine to the UI.
// Everything runs in this tab; no network I/O ever occurs after page load
// (and the repo build's CSP makes that a hard guarantee).

import { APP_CONFIG } from './config.js';
import { finalizeSpans } from '../../engine/detect.js';
import { CATEGORY_META as BASE_CATEGORY_META } from '../../engine/patterns.js';
import { isDangerouslyShort } from '../../engine/denylist.js';
import { sanitizePrefix, applyToText } from '../../engine/tokenize.js';
import { parseCsv, csvHeaders, columnSpansFor } from '../../engine/csv.js';
import { extractDocxPart, DOCX_TEXT_PART_RE } from '../../engine/docx.js';
import { exportDocx } from '../../docxExport.js';
import { createPdfEngine, loadPdfForReview } from '../../pdf.js';
import { initVault, loadVaultConfig, saveVaultConfig, eraseVault, vaultStatus } from './vault.js';
import { el, clearNode, on } from './ui/dom.js';

const CATEGORY_META = { ...BASE_CATEGORY_META, account: { label: 'Labelled account numbers', group: 'Financial', defaultOn: true } };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

import { PRESETS, normalizeProfile } from '../../profile.js';
import { detectStatementCandidates } from '../../statement.js';
import { notifyReady } from './vault.js';

const SAMPLE_TEXT = `NORTHBRIDGE BANK — ACCOUNT STATEMENT
Statement period: 2026-05-01 to 2026-05-31

Prepared for:
John Smith
123 Maple Avenue
Toronto ON  M5V 3L9
john.smith@example.com · (416) 555-0123

Account: 003-1234567          SIN on file: 046-454-286
Card on file: 4111 1111 1111 1111 (Visa)
Wire details: IBAN DE89 3704 0044 0532 0130 00
US payroll partner routing: 021000021, SSN 078-05-1120
Date of Birth: 03/14/1985

DATE        DESCRIPTION                        AMOUNT     BALANCE
2026-05-02  Payroll — Acme Widgets Ltd.        +3,120.00  8,455.10
2026-05-04  E-transfer to M. Smith             -200.00    8,255.10
2026-05-09  Order #4111111111111112 refund     +89.99     8,345.09
2026-05-14  Utility bill (acct 55-201-9982)    -142.55    8,202.54
2026-05-21  Clinic invoice 90210               -75.00     8,127.54
2026-05-30  Interest                           +1.02      8,128.56

Support: 1-800-555-0199 · Online: 192.168.1.42 (internal)
Thank you for banking with Northbridge.`;

// ------------------------------------------------------------------ state

const state = {
  config: null,
  candidates: null,
  spans: [],
  tokenMap: null,
  manualSpans: [],
  disabledKeys: new Set(),
  redactedColumns: new Set(),
  doc: null,
  pdfEnginePromise: null,
  pdfEngine: null,
  activePdfTab: 'pages',
  pendingSel: null,
  customSeq: 0,
  lastDownload: null // { url, name } — kept alive for the new-tab fallback
};

// Sandboxed contexts (hosted demos, embeds) usually lack the `allow-downloads`
// sandbox flag: anchor-triggered downloads are silently dropped by the browser
// with no error to catch. This can come from an <iframe sandbox> attribute OR
// from a `Content-Security-Policy: sandbox` RESPONSE HEADER — the latter also
// applies at top level. A sandbox without allow-same-origin gives the document
// an opaque origin, which reads as window.origin === 'null'; combined with an
// iframe check this covers both cases. When downloads are unreliable we never
// claim success and surface an "open in a new tab" escape hatch (popups that
// escape the sandbox CAN save the file).
const DOWNLOADS_UNRELIABLE = (() => {
  try {
    if (/[?&]forcefallback/.test(window.location.search)) return true; // test hook
    if (window.origin === 'null') return true;
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ boot

async function boot() {
  $('#verLabel').textContent = 'v' + APP_CONFIG.version;
  $('#repoLink').href = APP_CONFIG.repoUrl;
  wireChrome();
  wireConfigForm();
  wireDropzone();
  wireReview();
  try { await initVault(); }
  catch (e) { showView('main'); showError('Cannot load saved values', e.message); return; }
  // Environment line shown in the "verify" dialog — useful when reporting issues.
  const diag = $('#diagLine');
  if (diag) {
    diag.textContent = `Environment: origin ${window.origin} · ${window.self === window.top ? 'top-level' : 'embedded in a frame'} · ` +
      `persistent vault ${vaultStatus().persisted ? 'available' : 'unavailable'} · ` +
      `direct downloads ${DOWNLOADS_UNRELIABLE ? 'may be blocked here (fallback offered)' : 'expected to work'}`;
  }
  try { state.config = (await loadVaultConfig()) || null; }
  catch (e) { showView('main'); showError('Cannot load saved values', e.message); return; }
  if (state.config) {
    showView('main');
  } else {
    renderConfigForm(defaultConfig());
    showView('config', { firstRun: true });
  }
  notifyReady(handleFile);
}

function defaultConfig() {
  return normalizeProfile();
}

function showView(name, { firstRun = false } = {}) {
  $('#view-config').hidden = name !== 'config';
  $('#view-main').hidden = name !== 'main';
  $('#configIntro').hidden = !(name === 'config' && firstRun);
  $('#cancelConfig').hidden = firstRun || name !== 'config';
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ chrome

function wireChrome() {
  on($('#localBadge'), 'click', () => $('#verifyDialog').showModal());
  on($('#gearBtn'), 'click', () => {
    renderConfigForm(state.config || defaultConfig());
    showView('config', { firstRun: !state.config });
  });
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ------------------------------------------------------------------ config form

function wireConfigForm() {
  on($('#addCustom'), 'click', () => addCustomRow());
  on($('#saveConfigBtn'), 'click', saveConfigFromForm);
  on($('#cancelConfig'), 'click', () => showView('main'));
  let armed = false;
  on($('#wipeVault'), 'click', async () => {
    if (!armed) {
      armed = true;
      $('#wipeVault').textContent = 'Really erase everything? Click again';
      setTimeout(() => { armed = false; $('#wipeVault').textContent = 'Erase all saved values'; }, 4000);
      return;
    }
    let persisted;
    try { persisted = await eraseVault(); }
    catch (e) { toast('Could not erase saved values: ' + e.message, 5000); return; }
    state.config = null;
    renderConfigForm(defaultConfig());
    toast(persisted ? 'Saved values cleared on this device' : 'Cleared for this session only; persistent storage is unavailable', 5000);
    armed = false;
    $('#wipeVault').textContent = 'Erase all saved values';
  });
}

function renderConfigForm(cfg) {
  const grid = clearNode($('#presetFields'));
  for (const p of PRESETS) {
    const existing = (cfg.values || []).find((v) => v.id === 'p:' + p.key);
    const field = el('div', 'field');
    const label = el('label', null, p.label);
    label.htmlFor = 'preset-' + p.key;
    const input = el('input');
    input.id = 'preset-' + p.key;
    input.type = 'text';
    input.autocomplete = 'off';
    input.value = existing ? existing.value : '';
    const warn = el('span', 'short-warn', '');
    on(input, 'input', () => {
      warn.textContent = input.value.trim() && isDangerouslyShort(input.value)
        ? 'Very short — will over-redact (matches inside other words/numbers).'
        : '';
    });
    field.append(label, input, warn);
    grid.append(field);
  }

  clearNode($('#customRows'));
  for (const v of cfg.values || []) {
    if (v.id.startsWith('c:')) addCustomRow(v);
  }
  if (!(cfg.values || []).some((v) => v.id.startsWith('c:'))) addCustomRow();

  const wrap = clearNode($('#patternToggles'));
  const groups = new Map();
  for (const [key, meta] of Object.entries(CATEGORY_META)) {
    if (!groups.has(meta.group)) groups.set(meta.group, []);
    groups.get(meta.group).push([key, meta]);
  }
  for (const [groupName, entries] of groups) {
    const g = el('div', 'pat-group');
    g.append(el('div', 'pat-group-name', groupName));
    for (const [key, meta] of entries) {
      const row = el('label', 'pattern-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.dataset.pattern = key;
      cb.checked = key in (cfg.patterns || {}) ? !!cfg.patterns[key] : meta.defaultOn;
      const body = el('div');
      const lab = el('span', 'pr-label', meta.label);
      const tag = el('span', 'pr-tag ' + (meta.defaultOn ? 'rec' : 'tent'), meta.defaultOn ? 'recommended' : 'tentative');
      lab.append(tag);
      body.append(lab);
      if (meta.note) body.append(el('span', 'pr-note', meta.note));
      row.append(cb, body);
      g.append(row);
    }
    wrap.append(g);
  }

  const vs = vaultStatus();
  $('#vaultNote').textContent = vs.persisted
    ? '🔒 Everything you enter here is stored only on this device, encrypted at rest (AES-GCM). It is shared with Settings → Redaction and excluded from ledger backups. Page scripts can use the local key; encryption does not isolate it from this app.'
    : '⚠ Persistent storage is unavailable in this context (e.g. a sandboxed demo) — values are kept in memory for this session only, and still never leave the page.';
}

function addCustomRow(existing) {
  const rows = $('#customRows');
  const row = el('div', 'customrow');
  const label = el('input');
  label.type = 'text';
  label.placeholder = 'Label (e.g. spouse name, account #)';
  label.autocomplete = 'off';
  label.value = existing ? existing.label : '';
  const value = el('input');
  value.type = 'text';
  value.placeholder = 'Value to redact';
  value.autocomplete = 'off';
  value.value = existing ? existing.value : '';
  row.dataset.cid = existing ? existing.id : 'c:' + Date.now() + ':' + state.customSeq++;
  const warnWrap = el('div');
  warnWrap.append(value);
  const warn = el('span', 'short-warn', '');
  warnWrap.append(warn);
  on(value, 'input', () => {
    warn.textContent = value.value.trim() && isDangerouslyShort(value.value)
      ? 'Very short — will over-redact.'
      : '';
  });
  const rm = el('button', 'rm', '×');
  rm.type = 'button';
  rm.title = 'Remove';
  on(rm, 'click', () => row.remove());
  row.append(label, warnWrap, rm);
  rows.append(row);
}

async function saveConfigFromForm() {
  const values = [];
  for (const p of PRESETS) {
    const v = $('#preset-' + p.key).value.trim();
    if (v) values.push({ id: 'p:' + p.key, label: p.label, value: v, tokenPrefix: p.prefix });
  }
  for (const row of document.querySelectorAll('#customRows .customrow')) {
    const [labelInput, valueInput] = row.querySelectorAll('input');
    const value = valueInput.value.trim();
    if (!value) continue;
    const label = labelInput.value.trim() || 'Custom value';
    values.push({ id: row.dataset.cid, label, value, tokenPrefix: sanitizePrefix(label) });
  }
  const patterns = {};
  for (const cb of document.querySelectorAll('#patternToggles input[data-pattern]')) {
    patterns[cb.dataset.pattern] = cb.checked;
  }
  const nextConfig = { version: 1, values, patterns };
  let persisted;
  try { persisted = await saveVaultConfig(nextConfig); }
  catch (e) { toast('Could not save values: ' + e.message, 5000); return; }
  state.config = nextConfig;
  toast(persisted ? 'Saved — encrypted on this device only' : 'Saved for this session (storage unavailable here)');
  showView('main');
  if (state.doc) fullRescan();
}

// ------------------------------------------------------------------ file intake

function wireDropzone() {
  const dz = $('#dropzone');
  on(dz, 'dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  on(dz, 'dragleave', () => dz.classList.remove('dragover'));
  on(dz, 'drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  on($('#fileInput'), 'change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  });
  on($('#pasteToggle'), 'click', () => {
    const box = $('#pasteBox');
    box.hidden = !box.hidden;
    if (!box.hidden) $('#pasteArea').focus();
  });
  on($('#pasteGo'), 'click', () => {
    const text = $('#pasteArea').value;
    if (!text.trim()) { toast('Nothing to review — paste some text first'); return; }
    openDocument('text', 'pasted-text.txt', text);
  });
  on($('#sampleBtn'), 'click', () => openDocument('text', 'sample-statement.txt', SAMPLE_TEXT));
  on($('#errorBack'), 'click', resetToDropzone);
  on($('#nvConfigure'), 'click', () => {
    $('#noValuesDialog').close();
    renderConfigForm(state.config || defaultConfig());
    showView('config', { firstRun: !state.config });
  });
  on($('#nvPatternOnly'), 'click', () => $('#noValuesDialog').close());
}

function kindForFile(name) {
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  if (['txt', 'text', 'md', 'log'].includes(ext)) return 'text';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx') return 'docx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'doc') return 'unsupported-doc';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'heic', 'bmp'].includes(ext)) return 'unsupported-image';
  return 'text'; // best effort: treat unknown as text
}

async function handleFile(file) {
  const kind = kindForFile(file.name);
  if (kind === 'unsupported-doc') {
    showError('Legacy .doc files aren’t supported', 'Save the document as .docx (Word’s current format) and drop it again.');
    return;
  }
  if (kind === 'unsupported-image') {
    showError('Images and scans aren’t supported yet', 'Image files have no text layer to redact. Scanned-document support (OCR + image-region redaction) is planned for a later version — using it now would risk silently leaking what the image shows.');
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await openDocument(kind, file.name, buffer);
  } catch (err) {
    console.error(err);
    showError('Could not read that file', String(err?.message || err));
  }
}

function decodeText(buffer) {
  const text = typeof buffer === 'string' ? buffer : new TextDecoder('utf-8').decode(buffer);
  const bom = text.charCodeAt(0) === 0xfeff;
  return { text: bom ? text.slice(1) : text, bom };
}

async function openDocument(kind, name, data) {
  closeCurrentDoc();
  try {
    let doc;
    if (kind === 'text' || kind === 'csv') {
      const { text, bom } = decodeText(data);
      if (!text.trim()) { showError('This file is empty', 'There is no text to redact.'); return; }
      doc = { kind, name, bom, rawText: text, fullText: text, sections: [{ label: null, start: 0, end: text.length }] };
      if (kind === 'csv') doc.csvParsed = parseCsv(text);
    } else if (kind === 'docx') {
      doc = await openDocx(name, data);
      if (!doc) return;
    } else if (kind === 'pdf') {
      doc = await openPdf(name, data);
      if (!doc) return;
    }
    state.doc = doc;
    state.manualSpans = [];
    state.disabledKeys = new Set();
    state.redactedColumns = new Set();
    state.activePdfTab = 'pages';
    fullRescan();
    showReview();
    if (!(state.config?.values?.length)) $('#noValuesDialog').showModal();
  } catch (err) {
    console.error(err);
    showError('Could not open that document', String(err?.message || err));
  }
}

async function openDocx(name, data) {
  if (!window.JSZip) {
    showError('DOCX support unavailable', 'The JSZip library failed to load in this build.');
    return null;
  }
  const zip = await window.JSZip.loadAsync(data);
  const paths = Object.keys(zip.files)
    .filter((p) => DOCX_TEXT_PART_RE.test(p))
    .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  if (!paths.length) {
    showError('Not a Word document', 'This file doesn’t contain the expected DOCX structure.');
    return null;
  }
  const parts = [];
  for (const path of paths) {
    const xml = await zip.file(path).async('string');
    const extract = extractDocxPart(xml);
    parts.push({ path, xml, extract });
  }
  const kept = parts.filter((p) => p.path === 'word/document.xml' || p.extract.text.trim());
  const sections = [];
  let fullText = '';
  kept.forEach((part, i) => {
    if (i > 0) fullText += '\f';
    const start = fullText.length;
    fullText += part.extract.text;
    sections.push({ label: partLabel(part.path), start, end: fullText.length, partIndex: i });
  });
  if (!fullText.trim()) {
    showError('No readable text found', 'This document appears to contain no text.');
    return null;
  }
  return { kind: 'docx', name, zip, parts: kept, fullText, sections };
}

function partLabel(path) {
  const base = path.replace('word/', '').replace('.xml', '');
  if (base === 'document') return 'Document';
  return base.replace(/^([a-z]+)(\d*)$/, (_, w, n) => w[0].toUpperCase() + w.slice(1) + (n ? ' ' + n : ''));
}

async function ensurePdfEngine() {
  if (state.pdfEngine) return state.pdfEngine;
  if (!state.pdfEnginePromise) {
    toast('Loading PDF engine…');
    state.pdfEnginePromise = import(new URL(APP_CONFIG.mupdfModuleUrl, document.baseURI).href)
      .then((mod) => { state.pdfEngine = createPdfEngine(mod); return state.pdfEngine; });
  }
  return state.pdfEnginePromise;
}

async function openPdf(name, data) {
  let engine;
  try {
    engine = await ensurePdfEngine();
  } catch (err) {
    console.error(err);
    showError('PDF engine could not load',
      'The MuPDF WASM module failed to load in this environment. Text, CSV and DOCX still work. ' +
      'If you are on the hosted demo, run the app from the repository for full PDF support.');
    return null;
  }
  let session;
  try { session = loadPdfForReview(engine, new Uint8Array(data)); }
  catch (err) {
    showError('Could not open PDF for redaction', err.message);
    return null;
  }
  const sections = [];
  let fullText = '';
  session.pages.forEach((p, i) => {
    if (i > 0) fullText += '\f';
    const start = fullText.length;
    fullText += p.text;
    sections.push({ label: 'Page ' + (i + 1), start, end: fullText.length, pageIndex: i });
  });
  return { kind: 'pdf', name, session, fullText, sections, pageUrls: [] };
}

function closeCurrentDoc() {
  releaseLastDownload();
  const doc = state.doc;
  if (!doc) return;
  if (doc.kind === 'pdf') {
    for (const url of doc.pageUrls || []) { if (url) URL.revokeObjectURL(url); }
    state.pdfEngine?.close(doc.session);
  }
  state.doc = null;
  state.candidates = null;
  state.spans = [];
}

function resetToDropzone() {
  closeCurrentDoc();
  $('#review').hidden = true;
  $('#errorState').hidden = true;
  $('#dropzone').hidden = false;
  $('#pasteArea').value = '';
  $('#pasteBox').hidden = true;
  hideSelButton();
}

function showError(title, msg) {
  closeCurrentDoc();
  $('#dropzone').hidden = true;
  $('#review').hidden = true;
  const box = $('#errorState');
  box.hidden = false;
  $('#errorTitle').textContent = title;
  $('#errorMsg').textContent = msg;
}

function showReview() {
  $('#dropzone').hidden = true;
  $('#errorState').hidden = true;
  $('#review').hidden = false;
}

// ------------------------------------------------------------------ detection pipeline

function detectionHooks() {
  const lib = window.libphonenumber;
  if (lib?.findPhoneNumbersInText) {
    return {
      findPhoneNumbers: (text) => {
        try {
          return lib.findPhoneNumbersInText(text, 'US').map((f) => ({ start: f.startsAt, end: f.endsAt }));
        } catch {
          return [];
        }
      }
    };
  }
  return {};
}

function fullRescan() {
  if (!state.doc) return;
  const cfg = state.config || defaultConfig();
  state.candidates = detectStatementCandidates(state.doc.fullText, cfg, '', detectionHooks());
  refinalize();
}

function currentColumnSpans() {
  if (state.doc?.kind !== 'csv' || !state.redactedColumns.size) return [];
  const spans = [];
  for (const header of state.redactedColumns) {
    spans.push(...columnSpansFor(state.doc.csvParsed, header));
  }
  return spans;
}

function refinalize() {
  if (!state.doc) return;
  releaseLastDownload(); // A previous export no longer represents the current choices.
  const { spans, tokenMap } = finalizeSpans(state.doc.fullText, state.candidates || [], {
    manualSpans: state.manualSpans,
    columnSpans: currentColumnSpans(),
    disabledKeys: state.disabledKeys
  });
  state.spans = spans;
  state.tokenMap = tokenMap;
  renderReview();
}

// ------------------------------------------------------------------ review rendering

const HUE_VARS = ['--h0', '--h1', '--h2', '--h3', '--h4', '--h5', '--h6', '--h7'];
function hueForPrefix(prefix) {
  let h = 0;
  const s = prefix || 'X';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUE_VARS[h % HUE_VARS.length];
}

function styleSpanEl(node, sp) {
  node.style.setProperty('--hue', `var(${hueForPrefix(sp.prefix)})`);
  if (sp.enabled === false) node.classList.add('off');
  else if (sp.confidence === 'tentative') node.classList.add('tent');
  node.dataset.spanId = sp.id;
  node.title = `${sp.token || ''} · ${sp.label}${sp.enabled === false ? ' (off)' : ''} — click to toggle`;
}

function renderReview() {
  const doc = state.doc;
  if (!doc) return;
  $('#fileName').textContent = doc.name;
  $('#fileKind').textContent = doc.kind.toUpperCase();
  $('#modeNote').hidden = !!(state.config?.values?.length);

  renderChips();
  renderSummary();
  renderCsvColumns();
  renderPreview();

  const textlessPages = doc.kind === 'pdf'
    ? doc.session.pages.filter(p => !p.text.trim()).map(p => p.index + 1) : [];
  $('#pdfTextNote').hidden = textlessPages.length === 0;
  $('#pdfTextNote').textContent = textlessPages.length
    ? `Pages ${textlessPages.join(', ')} have no readable text. They are included unchanged in the PDF export. Check them in Page view; image content is not automatically redacted.` : '';
  $('#copyBtn').hidden = doc.kind === 'pdf';
  $('#downloadBtn').textContent = 'Download redacted ' + doc.kind.toUpperCase();
}

function groupedSpans() {
  const groups = new Map();
  for (const sp of state.spans) {
    if (!groups.has(sp.label)) groups.set(sp.label, []);
    groups.get(sp.label).push(sp);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

function renderChips() {
  const chips = clearNode($('#chips'));
  const enabled = state.spans.filter((s) => s.enabled);
  const total = el('span', 'chip total', `${enabled.length} redaction${enabled.length === 1 ? '' : 's'}`);
  chips.append(total);
  for (const [label, spans] of groupedSpans()) {
    const n = spans.filter((s) => s.enabled).length;
    chips.append(el('span', 'chip', `${label}: ${n}${n !== spans.length ? ` (of ${spans.length})` : ''}`));
  }
}

function snippetFor(sp) {
  const text = state.doc.fullText;
  const before = text.slice(Math.max(0, sp.start - 26), sp.start).replace(/[\n\f\t]+/g, ' ');
  const middle = text.slice(sp.start, sp.end).replace(/[\n\f\t]+/g, ' ');
  const after = text.slice(sp.end, sp.end + 26).replace(/[\n\f\t]+/g, ' ');
  return { before: (sp.start > 26 ? '…' : '') + before, middle, after: after + (sp.end + 26 < text.length ? '…' : '') };
}

function renderSummary() {
  const wrap = clearNode($('#summaryGroups'));
  const groups = groupedSpans();
  if (!groups.length) {
    const none = el('div', 'sumgroup');
    none.append(el('div', 'sumrow', 'Nothing detected. Select text in the preview to redact it manually, or add values in settings.'));
    wrap.append(none);
    return;
  }
  for (const [label, spans] of groups) {
    const details = el('details', 'sumgroup');
    details.open = groups.length <= 5;
    const summary = el('summary');
    const swatch = el('span', 'sum-swatch');
    swatch.style.background = `hsl(var(${hueForPrefix(spans[0].prefix)}))`;
    const enabledCount = spans.filter((s) => s.enabled).length;
    summary.append(swatch, el('span', null, label), el('span', 'count', `${enabledCount}/${spans.length}`));
    details.append(summary);
    for (const sp of spans) {
      const row = el('div', 'sumrow' + (sp.enabled ? '' : ' off'));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = sp.enabled;
      cb.title = sp.enabled ? 'Uncheck to keep this text' : 'Check to redact';
      on(cb, 'change', () => toggleSpan(sp.id));
      const snipBtn = el('button', 'snip');
      snipBtn.type = 'button';
      const { before, middle, after } = snippetFor(sp);
      snipBtn.append(document.createTextNode(before));
      snipBtn.append(el('b', null, middle));
      snipBtn.append(document.createTextNode(after));
      snipBtn.title = `${sp.token || ''} — click to locate`;
      on(snipBtn, 'click', () => scrollToSpan(sp.id));
      row.append(cb, snipBtn);
      details.append(row);
    }
    wrap.append(details);
  }
}

function renderCsvColumns() {
  const box = $('#csvColumns');
  if (state.doc.kind !== 'csv') { box.hidden = true; return; }
  box.hidden = false;
  clearNode(box);
  box.append(el('h4', null, 'Redact whole columns'));
  const headers = csvHeaders(state.doc.csvParsed);
  if (!headers.length) { box.append(el('div', 'csv-col-row', 'No header row found.')); return; }
  headers.forEach((h) => {
    if (!h.trim()) return;
    const row = el('label', 'csv-col-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.redactedColumns.has(h);
    on(cb, 'change', () => {
      if (cb.checked) state.redactedColumns.add(h);
      else state.redactedColumns.delete(h);
      refinalize();
    });
    row.append(cb, el('span', null, h));
    box.append(row);
  });
}

function renderPreview() {
  const doc = state.doc;
  const content = clearNode($('#previewContent'));
  const tabs = $('#pdfTabs');
  const note = $('#previewNote');
  note.hidden = true;

  if (doc.kind === 'pdf') {
    tabs.hidden = false;
    for (const btn of tabs.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.tab === state.activePdfTab);
    }
    if (state.activePdfTab === 'pages') {
      renderPdfPages(content);
    } else {
      note.hidden = false;
      note.textContent = 'Text view — layout is approximate; the downloaded PDF keeps its layout with the highlighted text truly removed. Select text here to add a redaction.';
      renderTextSections(content);
    }
  } else {
    tabs.hidden = true;
    if (doc.kind === 'docx') {
      note.hidden = false;
      note.textContent = 'Text preview — formatting is preserved in the downloaded file.';
    }
    renderTextSections(content);
  }
}

function renderTextSections(container) {
  const doc = state.doc;
  const showHeads = doc.sections.length > 1;
  for (const sec of doc.sections) {
    if (showHeads && sec.label) container.append(el('div', 'sect-head', sec.label));
    const pre = el('pre', 'doc-text');
    pre.dataset.sectionStart = sec.start;
    const text = doc.fullText.slice(sec.start, sec.end);
    const spans = state.spans.filter((s) => s.start >= sec.start && s.end <= sec.end);
    let pos = 0;
    for (const sp of spans) {
      const s = sp.start - sec.start;
      const e = sp.end - sec.start;
      if (s > pos) pre.append(document.createTextNode(text.slice(pos, s)));
      const mark = el('mark', 'mk', text.slice(s, e));
      styleSpanEl(mark, sp);
      pre.append(mark);
      pos = e;
    }
    pre.append(document.createTextNode(text.slice(pos)));
    container.append(pre);
  }
}

function renderPdfPages(container) {
  const doc = state.doc;
  const engine = state.pdfEngine;
  doc.session.pages.forEach((page, i) => {
    const sec = doc.sections[i];
    const wrap = el('div', 'pdf-page');
    wrap.style.width = page.width + 'px';
    wrap.style.maxWidth = '100%';
    if (!doc.pageUrls[i]) {
      const png = engine.renderPagePng(doc.session, i, APP_CONFIG.pdfRenderScale);
      doc.pageUrls[i] = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    }
    const img = el('img');
    img.src = doc.pageUrls[i];
    img.alt = 'Page ' + (i + 1);
    wrap.append(img);
    for (const sp of state.spans) {
      if (sp.start < sec.start || sp.end > sec.end) continue;
      const rects = engine.rectsForRange(doc.session, i, sp.start - sec.start, sp.end - sec.start, 0);
      for (const [x0, y0, x1, y1] of rects) {
        const ov = el('div', 'pdf-ov');
        ov.style.left = (100 * (x0 - page.bounds[0]) / page.width) + '%';
        ov.style.top = (100 * (y0 - page.bounds[1]) / page.height) + '%';
        ov.style.width = (100 * (x1 - x0) / page.width) + '%';
        ov.style.height = (100 * (y1 - y0) / page.height) + '%';
        styleSpanEl(ov, sp);
      wrap.append(ov);
      }
    }
    container.append(wrap);
    container.append(el('div', 'pdf-pagenum', 'Page ' + (i + 1) + ' of ' + doc.session.pages.length));
  });
}

// ------------------------------------------------------------------ interactions

function wireReview() {
  on($('#previewContent'), 'click', (e) => {
    const target = e.target.closest?.('[data-span-id]');
    if (target) toggleSpan(target.dataset.spanId);
  });
  on($('#rescanBtn'), 'click', () => { fullRescan(); toast('Re-scanned'); });
  on($('#newFileBtn'), 'click', resetToDropzone);
  for (const btn of document.querySelectorAll('#pdfTabs .tab')) {
    on(btn, 'click', () => {
      state.activePdfTab = btn.dataset.tab;
      renderPreview();
    });
  }
  on($('#downloadBtn'), 'click', downloadRedacted);
  on($('#openTabBtn'), 'click', openDownloadInTab);
  on($('#copyBtn'), 'click', copyRedactedText);

  // Manual redaction from text selection (design: "the single highest-value feature").
  on(document, 'pointerup', (e) => {
    if (e.target.id === 'selRedact') return;
    setTimeout(() => maybeShowSelButton(e), 0);
  });
  on(document, 'selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideSelButton();
  });
  on($('#selRedact'), 'click', () => {
    if (!state.pendingSel) return;
    state.manualSpans.push(state.pendingSel);
    hideSelButton();
    window.getSelection()?.removeAllRanges();
    refinalize();
    toast('Added manual redaction');
  });
}

function maybeShowSelButton(e) {
  if (!state.doc || $('#review').hidden) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideSelButton(); return; }
  const range = sel.getRangeAt(0);
  const pre = range.startContainer.parentElement?.closest?.('pre.doc-text') ||
    (range.startContainer.nodeType === 1 ? range.startContainer.closest?.('pre.doc-text') : null);
  if (!pre || !pre.contains(range.endContainer)) { hideSelButton(); return; }
  const sectionStart = Number(pre.dataset.sectionStart || 0);
  const preRange = document.createRange();
  preRange.selectNodeContents(pre);
  preRange.setEnd(range.startContainer, range.startOffset);
  let start = preRange.toString().length;
  let len = range.toString().length;
  // trim whitespace from selection edges
  const raw = range.toString();
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  start += leading;
  len -= leading + trailing;
  if (len <= 0) { hideSelButton(); return; }
  state.pendingSel = { start: sectionStart + start, end: sectionStart + start + len };
  const btn = $('#selRedact');
  btn.hidden = false;
  const x = Math.min(Math.max(8, e.clientX - 40), window.innerWidth - 150);
  const y = Math.min(e.clientY + 14, window.innerHeight - 48);
  btn.style.left = x + 'px';
  btn.style.top = y + 'px';
}

function hideSelButton() {
  state.pendingSel = null;
  $('#selRedact').hidden = true;
}

function toggleSpan(id) {
  const sp = state.spans.find((s) => s.id === id);
  if (!sp) return;
  if (state.disabledKeys.has(sp.key)) state.disabledKeys.delete(sp.key);
  else state.disabledKeys.add(sp.key);
  // Manual spans that get disabled are simply removed.
  if (sp.source === 'manual' && state.disabledKeys.has(sp.key)) {
    state.manualSpans = state.manualSpans.filter((m) => !(m.start === sp.start && m.end === sp.end));
    state.disabledKeys.delete(sp.key);
  }
  refinalize();
}

function scrollToSpan(id) {
  const target = $('#previewContent').querySelector(`[data-span-id="${CSS.escape(id)}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 2600);
}

// ------------------------------------------------------------------ download

function redactedName(name, fallbackExt) {
  if (/\.[^.]+$/.test(name)) return name.replace(/(\.[^.]+)$/, '_redacted$1');
  return name + '_redacted.' + fallbackExt;
}

function enabledSpans() {
  return state.spans.filter((s) => s.enabled);
}

async function buildRedactedBlob() {
  const doc = state.doc;
  const spans = enabledSpans();
  if (doc.kind === 'text' || doc.kind === 'csv') {
    let out = applyToText(doc.rawText, spans);
    if (doc.bom) out = '﻿' + out;
    const type = doc.kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
    return new Blob([out], { type });
  }
  if (doc.kind === 'docx') {
    const bytes = await exportDocx(doc.zip, doc.parts, doc.sections, spans);
    return new Blob([bytes], { type: DOCX_MIME });
  }
  if (doc.kind === 'pdf') {
    const engine = state.pdfEngine;
    const pageOps = doc.sections.map((sec) => {
      const boxes = [];
      for (const sp of spans) {
        if (sp.start < sec.start || sp.end > sec.end) continue;
        for (const rect of engine.rectsForRange(doc.session, sec.pageIndex, sp.start - sec.start, sp.end - sec.start)) {
          boxes.push({ rect, token: sp.token });
        }
      }
      return { pageIndex: sec.pageIndex, boxes };
    });
    const bytes = engine.redactToBytes(doc.session, pageOps);
    return new Blob([bytes], { type: 'application/pdf' });
  }
  throw new Error('Unknown document kind');
}

function releaseLastDownload() {
  if (state.lastDownload) {
    URL.revokeObjectURL(state.lastDownload.url);
    state.lastDownload = null;
  }
  $('#dlFallback').hidden = true;
}

async function downloadRedacted() {
  const btn = $('#downloadBtn');
  btn.disabled = true;
  try {
    const blob = await buildRedactedBlob();
    const name = redactedName(state.doc.name, state.doc.kind === 'csv' ? 'csv' : 'txt');
    if (state.lastDownload) URL.revokeObjectURL(state.lastDownload.url);
    state.lastDownload = { blob, url: URL.createObjectURL(blob), name };
    const a = document.createElement('a');
    a.href = state.lastDownload.url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    if (DOWNLOADS_UNRELIABLE) {
      // The attempt above works when the host permits downloads; when it
      // doesn't, the browser drops it silently — so offer the escape hatch
      // and don't claim success.
      $('#dlFallback').hidden = false;
      toast(`${name} is ready — if no download started, use “Open it in a new tab” below`, 5200);
    } else {
      toast(`Downloaded ${name}`);
    }
  } catch (err) {
    console.error(err);
    toast('Download failed: ' + String(err?.message || err), 4200);
  } finally {
    btn.disabled = false;
  }
}

// Escape hatch for sandboxed hosts: open an (unsandboxed, thanks to
// allow-popups-to-escape-sandbox) popup and build a small save page in it.
// The blob URL is minted inside the popup and wired to a real download link,
// so even if the auto-click is suppressed the user has a guaranteed,
// user-gesture save button in a window where downloads are permitted.
function openDownloadInTab() {
  const dl = state.lastDownload;
  if (!dl) return;
  const win = window.open('', '_blank');
  if (!win) {
    toast('Pop-up blocked — allow pop-ups for this page and try again', 4200);
    return;
  }
  try {
    const d = win.document;
    d.title = dl.name;
    d.body.style.cssText =
      'font:15px system-ui,sans-serif;background:#101614;color:#e6ece9;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;min-height:92vh;gap:14px;text-align:center;padding:24px;margin:0';
    const h = d.createElement('h1');
    h.textContent = dl.name;
    h.style.cssText = 'font-size:19px;margin:0;word-break:break-all';
    const p = d.createElement('p');
    p.textContent = 'Your redacted copy was produced locally in the LocalRedact tab and never left your device. Click below to save it.';
    p.style.cssText = 'color:#94a39c;max-width:52ch;margin:0';
    const a = d.createElement('a');
    a.textContent = 'Save ' + dl.name;
    a.href = win.URL.createObjectURL(dl.blob);
    a.download = dl.name;
    a.style.cssText = 'background:#0e7a4e;color:#fff;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none';
    d.body.append(h, p, a);
    win.setTimeout(() => { try { a.click(); } catch { /* user clicks manually */ } }, 250);
    toast('Opened a new tab — the download starts there (or click Save)');
  } catch (err) {
    console.error(err);
    // Last resort: navigate the popup straight to the blob.
    try { win.location.href = dl.url; } catch { /* give up quietly */ }
    toast('Opened in a new tab — save the file from there');
  }
}

async function copyRedactedText() {
  const doc = state.doc;
  let out;
  if (doc.kind === 'text' || doc.kind === 'csv') {
    out = applyToText(doc.rawText, enabledSpans());
  } else {
    out = applyToText(doc.fullText, enabledSpans()).replaceAll('\f', '\n\n');
  }
  try {
    await navigator.clipboard.writeText(out);
    toast('Redacted text copied — review remaining context before sharing');
  } catch {
    // Clipboard API can be unavailable in sandboxed contexts.
    const ta = document.createElement('textarea');
    ta.value = out;
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Redacted text copied — review remaining context before sharing');
    } catch {
      toast('Copy failed — use Download instead', 3600);
    }
    ta.remove();
  }
}

// ------------------------------------------------------------------ go

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
