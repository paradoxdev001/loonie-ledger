# Loonie Ledger

A local-only household finance tracker for Canadian bank statements. No accounts, no cloud, no build step.

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

All data is local to your browser. Use **Export backup** (header) to save a JSON snapshot and **Import backup** to restore. No data leaves your machine.
