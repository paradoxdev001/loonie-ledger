# Loonie Ledger

A local-only household finance tracker for bank statements. No accounts, no cloud, no build step.

## Features

- **Import CSV and PDF statements** from any institution. Built-in parsers are included for TD, RBC, Amex, and BMO, plus a generic CSV fallback.
- **Auto-categorization** of transactions via rule-based matching, with manual review before import.
- **Deduplication** — re-importing an overlapping statement won't create duplicate transactions.
- **Spending reports** and recurring-bill detection, charted with Chart.js.
- **AI-assisted converter authoring** — point the wizard at a statement from an unsupported bank and it drafts a parser spec for you (bring your own Anthropic or OpenAI key). The model receives a sample you review and redact with the integrated Local Redact engine. Any transaction details left in that sample are shared; parsing stays deterministic and local.
- **Fully local** — all data lives in your browser (IndexedDB), with JSON export/import for backups.

## Running locally

ES modules require an HTTP server — double-clicking `index.html` won't work. Start one with:

```sh
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Any static file server works: `npx serve`, VS Code Live Server, etc.

## Architecture

The app is split into native ES modules under `src/`. No build step, no npm, no bundler — the browser loads them directly. Libraries (React 18, PapaParse, PDF.js, Chart.js, Tailwind) are loaded from CDN as UMD globals.

```
src/
  html.js                  htm tagged template → html`<div>` replaces JSX
  react.js                 re-exports hooks from window.React
  constants.js             CATEGORIES, ACCOUNT_TYPES, KNOWN_INSTITUTIONS, etc.
  utils.js                 parseDate, formatMoney, fingerprint, classNames, etc.
  state.js                 AppContext, reducer, initialState, useApp
  main.js                  App component + ReactDOM mount
  data/
    builtinConverters.js   built-in converter specs (TD, RBC, Amex, BMO, …)
  engine/
    converter.js           applyConverter — interprets CSV and PDF specs
    categorizer.js         rule-based auto-categorizer
    bootstrap.js           heuristic spec suggester for unknown files
  llm/
    adapter.js             callLLM — Anthropic (tool use) + OpenAI (json_schema)
  db/
    store.js               in-memory STORE + IndexedDB/localStorage fallback + dao
  components/
    ui/index.js            Button, Card, Modal, Badge, Toast, Input, Select, …
    Layout.js              Header, PageContainer, PageHeader, Footer
    Upload.js              UploadView — file drop, converter picker, batch import
    BootstrapWizard.js     manual + AI-assisted converter authoring
    Review.js              ReviewView — pre-import transaction editing
    Transactions.js        TransactionsView — filter, search, export, categorize
    Reports.js             ReportsView — Chart.js spending charts
    History.js             HistoryView — upload history
    Converters.js          ConvertersView — manage converter specs
```

## Converter specs

Each institution's parser is a JSON spec stored in the DB. See `CLAUDE.md` for the full format reference (CSV, PDF line-regex, PDF column-layout). Built-in specs live in `src/data/builtinConverters.js`; custom ones created via the UI are stored in IndexedDB and included in DB exports.

## Data

Your ledger is stored locally in your browser. Optional AI converter setup shares the approved statement sample; AI category suggestions share transaction descriptions. Use **Export backup** (header) to save a JSON snapshot and **Import backup** to restore. Ordinary imports do not send statement contents to a server. The app currently loads its UI libraries from CDNs, so initial loading requires network access.

## License

[MIT](LICENSE) © Paradox Dev

The redaction workspace bundles third-party libraries with their own licenses under `src/redaction/vendor/`:
[MuPDF](https://mupdf.com/) (AGPL-3.0), [JSZip](https://stuk.github.io/jszip/) (MIT) and
[libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (MIT). Because MuPDF is AGPL,
anyone who deploys a modified copy of this app must also publish their source, as this repository does.
The imported Local Redact code keeps its MIT notice in `src/redaction/LICENSE`.

## Redaction workspace and saved values

Open **Settings → Redaction** to save first name, last name, email, address,
phone, custom label/value pairs and detection preferences. The encrypted local
profile applies automatically in both the document workspace and AI converter
sample review. Keep using the same browser and URL (including the port).

Open **Redact** for Local Redact's complete document workflow: TXT, CSV, DOCX and
text-based PDF; highlighted matches, manual selection, whole-column CSV redaction,
PDF page/text views, copying and same-format exports. Or choose one statement in
**Upload → Review full document** to review that file directly, without AI setup. The initial upload preview already
applies your saved redaction settings, reports detected matches, and keeps original
text hidden until you explicitly reveal it.
Downloads use a `_redacted` filename suffix. Originals remain unchanged for local
financial parsing. Entirely scanned PDFs and images require OCR. PDFs with a mixture of readable
and textless pages open for review; textless pages are preserved unchanged. Automatic detection can miss information; review the output.

Converter setup uses the same saved values before either API or clipboard sharing.
Validation follow-ups share counts rather than original rows or error strings.
User-written follow-up messages are shared as entered. AI category suggestions
still use their separate description-sharing flow.

Saved values are excluded from ledger backups and managed separately from ledger
resets. Existing settings in a separately hosted Local Redact app are not migrated
automatically. See [integration notes](src/redaction/README.md) for architecture,
limits and upstream features preserved. Bundled libraries retain their separate
license notices under `src/redaction/vendor/` (including MuPDF).

Run the regression tests with Node 22+ (no npm install needed):

```sh
node --experimental-default-type=module --test tests/redaction/*.mjs
```
