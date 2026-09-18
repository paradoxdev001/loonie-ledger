# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A local-only household finance tracker split into native ES modules under `src/`. No build step, no npm, no bundler. Libraries (React 18, PapaParse, PDF.js, Chart.js, Tailwind) are loaded from CDN as UMD globals. JSX is replaced with **htm** tagged template literals. The CSV sample file `download-transactions.csv` is a test fixture for the RBC Visa converter. The one exception to "no vendored code" is the redaction module under `src/redaction/`, which ships its own libraries (MuPDF wasm, JSZip, libphonenumber-js) so the redaction iframe can run under a self-only CSP. Tests exist only for that module and run on Node 22+ with no install step (see Development workflow).

## Architecture

`index.html` is a thin shell that loads CDN scripts and then `<script type="module" src="src/main.js">`. All app logic lives in `src/`.

### File map

| File | Responsibility |
|------|---------------|
| `src/html.js` | `htm.bind(React.createElement)` — `html\`` tagged template replaces JSX |
| `src/react.js` | Re-exports hooks from `window.React` |
| `src/constants.js` | `CATEGORIES`, `ACCOUNT_TYPES`, `KNOWN_INSTITUTIONS`, `MONTH_ABBR`, etc. |
| `src/utils.js` | `parseDate`, `formatMoney`, `fingerprint`, `classNames`, `formatBatchSummary`, etc. |
| `src/state.js` | `AppContext`, `useApp`, `reducer`, `initialState` |
| `src/main.js` | `App` component, view routing, `ReactDOM.createRoot` mount |
| `src/data/builtinConverters.js` | `BUILTIN_CONVERTERS` array + `RETIRED_BUILTIN_KEYS` |
| `src/engine/converter.js` | `applyConverter`, `buildYearResolver`, `pdfToText`, `pdfToRows`; sets PDF.js worker URL |
| `src/engine/categorizer.js` | `autoCategorize`, `extractMerchant`, `inferTxnType`, `reconcileTypeForCategory`, `DEFAULT_RULES` |
| `src/engine/bootstrap.js` | `suggestCSVSpec`, `suggestPDFSpec` — heuristic spec suggester |
| `src/llm/adapter.js` | `callLLM`, `getLLMConfig`/`setLLMConfig`, `SPEC_JSON_SCHEMA`, `normalizeWizardSpec` |
| `src/db/store.js` | `STORE`, `dao`, `initDB`, `seedBuiltins`, `STORAGE_MODE` (live binding) |
| `src/components/ui/index.js` | `Button`, `Card`, `Modal`, `Badge`, `Toast`, `Input`, `Select`, etc. |
| `src/components/Layout.js` | `Header`, `PageContainer`, `PageHeader`, `Footer` |
| `src/components/Upload.js` | `UploadView`, `DropZone`, `ConverterMatchPanel`; filename-reuse via `findReuseHint` |
| `src/components/BootstrapWizard.js` | `BootstrapWizard`, `AIConverterWizard`, `InstitutionPicker`, `LivePreview`, `APIKeyModal` |
| `src/components/Review.js` | `ReviewView` — pre-import transaction editing |
| `src/components/Transactions.js` | `TransactionsView` — filter, search, export, AI categorize |
| `src/components/Reports.js` | `ReportsView` — Chart.js charts; also exports `detectRecurring` |
| `src/components/History.js` | `HistoryView` — upload history |
| `src/components/Converters.js` | `ConvertersView` — manage/edit/delete converter specs |
| `src/components/DocumentRedaction.js` | `DocumentRedaction` (iframe host + postMessage profile bridge), `RedactionView` — the Redact tab |
| `src/components/RedactionReview.js` | `RedactionReview` — detect/approve a statement sample before it goes to an AI |
| `src/components/RedactionSettings.js` | `RedactionSettings` — Settings → Redaction card (saved personal values + detector toggles) |
| `src/components/UploadPrivacyPreview.js` | `UploadPrivacyPreview` — auto-redacted preview on the Upload page; original hidden behind an explicit reveal |
| `src/redaction/profile.js` | `PRESETS`, `normalizeProfile`, `loadProfile`/`saveProfile`, `vaultStatus` — the shared redaction profile service |
| `src/redaction/statement.js` | `detectStatementCandidates`, `reviewStatement`, `safeValidationSummary`, `statementPrompt` — finance-specific policy over the engine |
| `src/redaction/vault.js` | AES-GCM + IndexedDB encrypted vault (DB `loonieledger_redaction`), in-memory fallback when storage is unavailable |
| `src/redaction/pdf.js` | `createPdfEngine(mupdf)` — MuPDF wrapper: page previews + true content-removal redaction |
| `src/redaction/engine/` | Upstream Local Redact engine, unmodified: `patterns.js`, `detect.js`, `tokenize.js`, `denylist.js`, `normalize.js`, `validators.js`, `csv.js`, `docx.js` |
| `src/redaction/workspace/` | Upstream Local Redact vanilla-JS UI (`index.html`, `js/app.js`, `css/app.css`) loaded in an iframe; `js/vault.js` bridges to the parent |
| `src/redaction/vendor/` | Vendored MuPDF (AGPL-3.0, ~10 MB wasm), JSZip, libphonenumber-js, plus licence files and `VERSIONS.json` |
| `tests/redaction/` | Node test-runner suites (`*.test.mjs`) for the engine, vault/profile, statement policy, and CSV/DOCX/PDF round-trips |

### Data model

Five in-memory tables (persisted as one JSON blob under key `state_v1`):

- **accounts** — `{ id, institution, account_name, account_type, currency }` — unique on `(institution, account_name)`
- **converters** — `{ id, key, name, institution, account_type, format, spec_json, is_builtin }` — unique on `key`
- **documents** — `{ id, filename, format, institution, account_id, converter_id, status }` — upload history
- **transactions** — `{ id, document_id, account_id, transaction_date, amount, description, category, transaction_type, fingerprint }` — deduplicated on `(account_id, fingerprint)`
- **category_rules** — `{ id, pattern, match_type, category, priority, amount_op, amount_value, amount_value2 }` — applied in priority order. The amount fields are optional: `amount_op` is `null`|`'eq'`|`'gt'`|`'lt'`|`'between'`, compared against the transaction's **absolute** amount (sign-agnostic). A rule needs at least one of {`pattern`, `amount_op`}; when both are set they AND. `autoCategorize` consults user rules first (so an amount-conditioned rule can re-tag a generic `transfer`/`cc_payment` that would otherwise short-circuit to its type default), then falls back to `DEFAULT_RULES` and the type default.

### Converter spec format

A converter `spec` is a JSON object stored in `spec_json`. Two types:

**CSV spec:**
```json
{
  "type": "csv",
  "has_header": true,
  "delimiter": ",",
  "skip_top_rows": 0,
  "columns": { "transaction_date": "Date", "description": "Description", "amount": "Amount" },
  "date_format": "MM/DD/YYYY",
  "amount_handling": "single_signed",
  "amount_sign": "natural",
  "account_type": "chequing",
  "default_account": "My Chequing",
  "default_currency": "CAD"
}
```

`amount_handling` is either `single_signed` (one column, negative = expense) or `split_debit_credit` (two columns). `amount_sign` is `natural` or `flipped` (flipped is for credit-card statements where charges print as positive but should normalize to negative).

**PDF spec:**
```json
{
  "type": "pdf",
  "line_regex": "^([A-Z]{3}\\s+\\d{1,2})\\s+([A-Z]{3}\\s+\\d{1,2})\\s+(.+?)\\s+(-?\\$[\\d,]+\\.\\d{2})$",
  "groups": { "transaction_date": 1, "posted_date": 2, "description": 3, "amount": 4 },
  "date_format": "MMM DD",
  "amount_handling": "single_signed",
  "amount_sign": "flipped",
  "period_regex": "STATEMENT\\s+FROM\\s+([A-Z]{3})\\s+\\d{1,2}(?:,\\s+(\\d{4}))?\\s+TO\\s+([A-Z]{3})\\s+\\d{1,2},\\s+(\\d{4})",
  "period_groups": { "start_month": 1, "start_year": 2, "end_month": 3, "end_year": 4 },
  "account_type": "credit_card",
  "default_account": "RBC Visa",
  "default_currency": "CAD"
}
```

`line_regex` matches one transaction line in the PDF text (pdf.js extracts text per page and clusters items by Y coordinate). `groups` maps regex capture-group indices to fields. `date_format` supports `MMM` for three-letter month names alongside `YYYY/YY/MM/M/DD/D`.

Some PDFs (notably Amex Canada) split a transaction across two lines: date + description on one row, signed amount alone on the next. For those, set `next_line_amount_regex` and leave the amount out of `line_regex`. When set, `groups.amount` indexes into the next-line match instead of the line match; the engine scans forward up to `next_line_amount_lookahead` lines (default 5) for an amount, stopping early if it hits another `line_regex` match. This keeps existing single-line specs (RBC) unchanged — they just leave `next_line_amount_regex` unset.

PDF specs can include an optional `totals` array for a post-parse sanity check. Each entry has `regex` (capture group 1 = a dollar amount printed on the statement), `match` (`'all'` | `'positive'` | `'negative'` — which parsed transactions to sum and compare against, where positive/negative refer to `signed_amount` after the amount_sign flip), and `label` (for error messages). The engine forces the `/g` flag, sums all matches in the document, applies the same `amount_sign` flip the transactions got, and emits a non-fatal warning in the review UI when the parsed sum disagrees by more than 1¢. Missing matches are a soft skip — not every statement prints every total. Examples: Amex Platinum uses two entries (`Total of New Transactions for ...` vs negative-signed sum, `Total of Payment Activity ...` vs positive-signed sum); RBC Visa uses one entry summing `SUBTOTAL OF MONTHLY ACTIVITY` across cardholders against the all-signed sum.

PDF transaction lines often print only `MMM DD` with no year, so `period_regex` + `period_groups` are how the engine recovers the year — it reads the statement's start/end month+year from the header and resolves each transaction's year from its month abbreviation. `start_year` may be omitted in the capture (e.g. RBC's same-year header `STATEMENT FROM JUN 10 TO JUL 9, 2025`); `buildYearResolver` defaults it to `end_year`, shifting back one if the start month is later than the end month. 2-digit years like TD Business's `JAN 30/26` are auto-promoted to `20YY`. Without `period_regex`, the engine falls back to `spec.year`, then `ctx.statement_year`, then the current year — which silently produces wrong dates if transaction lines lack a year. `applyConverter` pushes a non-fatal warning to the parse result when `period_regex` is configured but didn't match, so this is visible in the upload UI.

**Column-layout PDF spec:** When a PDF's row is genuinely tabular and the meaning of an amount depends on which column it sits in (TD Business chequing: same row position for debit vs credit), regex-on-joined-text can't disambiguate. Set `layout: "columns"` and provide a `columns` array of `{ name, x_min, x_max }` entries. The engine then calls `pdfToRows` (preserves per-item x-coords) and `bucketByColumns` to split each row's items by x-range into named fields. Standard field names: `description`, `debit`, `credit`, `date`, `balance` (or `amount` for `single_signed`). Rows whose `date` field doesn't parse are silently skipped — that's how table headers, summaries, and the `BALANCE FORWARD` row get filtered out. `date_format` works the same as in line-regex mode; `parseDate` handles compact formats like `MMMDD` (no separator) by splitting on letter↔digit boundaries. `totals` work the same way, with one engine convenience: when the printed total is unsigned (e.g. `Debits 4 241.42`) and a `match` filter implies a sign direction, the engine auto-aligns expected's sign so it compares against the filtered signed sum correctly.

Columns-mode also supports two optional spec fields for statements that bundle multiple accounts or wrap descriptions:

- `account_section_regex` + `account_section_end_regex` — scope emission to a single account section in a multi-account PDF (BMO Everyday Banking prints Primary + Interest in one file). Both regexes run against each row's joined text (each item joined with a single space). Rows are ignored until the start regex matches; after that, transactions are emitted until the end regex matches (or end of file). The matching header/footer rows themselves are skipped, not emitted. Anchor the start regex on fragments that only appear in the transaction section, not the summary table — if the section header's words live on different Y-rows in the summary but on one Y-row in the body (BMO's case), requiring both fragments together is enough.
- `merge_continuation_rows: true` — fold undated rows below a transaction into its description. BMO wraps long detail like `HYUNDAI PMNT CT` / `MSP/DIV` onto a second Y-row with no date and no amounts; the engine appends the continuation row's `description` field to the most recently emitted transaction. A row is only treated as a continuation when it has description text and no parseable amount, so a misaligned data row won't get swallowed.
- `description_strip_regex` (+ optional `description_strip_regex_flags`) — applied to each extracted description before fingerprinting/categorization/merchant extraction. BMO prefixes every chequing debit with `Pre-Authorized Payment, ` or `Online Bill Payment, `, which (a) dominates the truncated review-column display and (b) feeds the first 4 tokens to `extractMerchant`, both of which hide the actual payee. Stripping the boilerplate up front lets both Description and Merchant lead with the meaningful text.

The `period_regex` flow also supports end-date-only headers. When `period_groups` only captures `end_month` + `end_year` (no `start_month`/`start_year`), `buildYearResolver` builds a trailing-12-month map: months ≤ end_month resolve to end_year, later months to end_year - 1. BMO uses this for `For the period ending April 17, 2026`.

### Sign convention

After normalization, `amount < 0` = money out (expense), `amount > 0` = money in (income/payment). `inferTxnType()` maps signed amount + account type to `transaction_type`: `expense`, `income`, `transfer`, `refund`, or `cc_payment`.

Four categories *are* transaction types: **Income / Refund / Credit Card Payment / Transfer**. Reports classify inflow vs. spend off `transaction_type` + `signed_amount` (not category), so assigning one of these categories must also realign the type and re-sign the stored `signed_amount` — otherwise a `transfer` re-tagged as Income still reports as an outflow. `reconcileTypeForCategory(category, txn)` returns `{ transaction_type, signed_amount }` for those four (income/refund/cc_payment forced positive; transfer keeps its `deriveSignedAmount` directional heuristic) or `null` for ordinary spending categories. It's applied wherever a category is assigned: import (`Upload.js`), rule "apply to existing" and the manual category dropdown (`Transactions.js`). This matters especially for amount-conditioned category rules, whose whole point is re-tagging an otherwise-generic transfer.

### Persistence

`detectStorageMode()` tries IndexedDB → localStorage → in-memory on startup. The entire `STORE` object is serialized as one blob. `persistDB()` is debounced 200 ms; `persistNow()` is immediate. Export/import is available via the UI (produces the raw JSON).

### AI-assisted converter authoring

Alongside the heuristic Bootstrap Wizard, users can author a converter conversationally — with an API key (auto) or via clipboard copy/paste into any chat assistant (no key). `ConverterMatchPanel` offers "✨ Set up with AI" (no-converter case and the "none match?" line), which opens `AIConverterWizard`. The model's **only** output is a converter spec JSON — the same shape Module 3 consumes — so it never sees transaction data and any structured-output-capable model works. Parsing stays 100% deterministic.

**Provider adapter (Module 1.5):** `callLLM({ provider, apiKey, model, messages })` normalizes two providers to `{ spec, text }`. Anthropic forces structured output via **tool use** (`tool_choice` on `emit_converter_spec`); OpenAI uses **`response_format: json_schema`** (left non-strict on purpose — `SPEC_JSON_SCHEMA` is permissive with optional fields + `additionalProperties: true`, which strict mode forbids). Both share `SPEC_JSON_SCHEMA` and `LLM_SYSTEM_PROMPT` (an abbreviated copy of this spec doc). Defaults are top-tier per provider: Anthropic `claude-sonnet-4-6`, OpenAI `gpt-4o` (no model picker UI yet — edit `LLM_PROVIDERS` to change). Keys live in `localStorage` (`loonieledger_llm_provider`, `loonieledger_llm_key_anthropic`, `loonieledger_llm_key_openai`) via `getLLMConfig`/`setLLMConfig`, **never** in `STORE`, so they're excluded from DB exports.

**Browser-direct calls:** both providers normally block browser requests via CORS. Anthropic is opted-in with the `anthropic-dangerous-direct-browser-access: true` header; OpenAI just needs the `Authorization` bearer. This is acceptable only because each user brings their own rotatable key (the danger the header guards against — leaking *your* key to *other people's* browsers — doesn't apply when the key owner is the only browser). A future server component would move the call server-side and drop the header.

**Wizard flow (`AIConverterWizard`):** has stages `notice → redact → mode → (key) → chat`. The privacy `notice` confirms, then `handleNoticeConfirmed` extracts the document excerpt **once, up front** — for PDFs it sends `pdfToText` output **plus a `pdfToRows` x-coordinate sample** so `layout:"columns"` statements (TD Business, BMO) are solvable, since plain text loses the x-coords that distinguish debit vs. credit. The raw excerpt lands in `redactionSource` (guarded by an `extractionId` ref so a stale extraction can't overwrite a newer one; an empty excerpt is a fatal "needs OCR" error) and the `redact` stage renders `RedactionReview` over it. Only when the user approves does the reviewed text land in `clipDocCtx`, which gates *both* delivery paths — `startAnalysis` reads `clipDocCtx` and has **no fallback** to the unreviewed source. The `mode` screen shows the approved sample read-only with a "Review redaction again" button; the review's `draft` (custom values, disabled spans, manual edits, profile key) is kept in `redactionDraft` so re-opening restores the user's choices. `buildFirstText(clipDocCtx)` delegates to `statementPrompt(format, text)`, which deliberately omits the filename. The `mode` screen then forks:

- **Option 1 — API key (`mode==='api'`):** runs the **auto-validation loop** — after each spec it calls `applyConverter` locally and feeds `safeValidationSummary(parseResult)` back to the model for up to 2 silent retries before handing control to the user, who refines further in chat.
- **Option 2 — Clipboard (`mode==='clip'`, no key):** mirrors the categorize flow's clipboard option. `clipPrompt` (derived) is `LLM_SYSTEM_PROMPT` + `buildFirstText(clipDocCtx)` on turn 1, and an **incremental** follow-up (`buildFollowupPrompt` = `safeValidationSummary(parseResult)` + the user's tweak) on later turns — never the whole transcript, since the user's Claude.ai/ChatGPT chat keeps context. The user copies, pastes the reply back, and `extractSpecJson` (forgiving: prefers a ```json fence, else outermost `{…}`) → `normalizeWizardSpec` → `validate` runs it locally. Round-1 instructions show a 3-step indicator driven by `clipStepActive` (copy → paste into chat → paste reply); the **Copy follow-up** button stays disabled when the parse is clean and no tweak is typed, so it can't mislead.

Both paths share `LivePreview`, the parsed/warnings chips, and a soft save gate (`parsedCount > 0`, not zero-errors, since valid converters emit benign warnings). When a spec parses but Save is still disabled, a hint names the missing required field (converter name / institution). `normalizeWizardSpec()` folds the schema's `pdf_columns` array into `spec.columns` (what the engine reads) before validation/save. Redaction only affects the AI prompt — the saved converter always parses the **full original file** locally, and saved specs are indistinguishable from manually-authored ones. `safeValidationSummary` is the only summary that may reach a model: it emits row/warning **counts** and never rows, warning strings or exception text, because converters interpolate source text into all three. User-typed follow-up messages are sent verbatim.

### Redaction module (Local Redact integration)

`src/redaction/` is a port of the standalone MIT-licensed **Local Redact** app. Its engine and vanilla-JS workspace UI are kept as close to upstream as possible (see `src/redaction/README.md` for the list of intentional adaptations and `docs/review-and-redaction.md` for the integration review); ledger-specific policy lives in `statement.js` and `profile.js`, and React wrappers live in `src/components/`. Three entry points share one saved profile:

- **Redact tab** (`RedactionView` → `DocumentRedaction`) — hosts `workspace/index.html` in a same-origin `<iframe>`. The workspace has its own strict self-only CSP, but that is *not* a security boundary against the parent page's scripts. It handles full-document TXT/CSV/DOCX/text-PDF review and same-format `_redacted` exports; MuPDF is `import()`ed lazily only when a PDF is opened. PDFs with at least one text page are accepted; entirely textless PDFs need OCR, which the app does not provide.
- **Upload → Review full document** — `UploadView` renders `UploadPrivacyPreview` in place of the old raw `<pre>` preview. It runs `reviewStatement` over the **full** extracted text (not the 2000-char clip, so identifiers can't be cut mid-token at the boundary), shows the redacted text, and hides the original behind an explicit reveal button. File selection is guarded by a `selectionId` ref so a slow PDF extraction can't populate a preview for a file the user has since replaced. The button opens `DocumentRedaction` in a modal and posts the dropped `File` into the iframe.
- **AI converter wizard `redact` stage** — `RedactionReview` (see Wizard flow above).

**Profile + vault.** A profile is `{ version, values: [{ id, label, value, tokenPrefix }], patterns: { <category>: bool } }`. Preset values (`PRESETS` in `profile.js`: first/last name, email, address, city, postal, phone) have ids `p:<key>`; custom pairs are `c:<uuid>`; per-review session values from the `RedactionReview` textarea are `session:<n>` and are never saved. `normalizeProfile` drops blank values, derives `tokenPrefix` from the label via `sanitizePrefix` ("Account number" → `ACCOUNT_NUMBER`), and forces finance-oriented detector defaults (`phone`, `dob`, `account` on; `zip_us` off). The profile is encrypted with a **non-extractable** AES-GCM key and stored in its own IndexedDB database (`loonieledger_redaction`, stores `keys` + `vault`) — it is **not** part of `STORE`, so it is excluded from JSON backups and untouched by factory reset. `initVault` degrades to in-memory when IndexedDB/WebCrypto is unavailable and `vaultStatus().persisted` tells the UI to say "session only". A failed decrypt **throws** rather than returning an empty profile, so personal matching never silently switches off. Never put profile values in `STORE`, `localStorage`, or any prompt.

**Iframe bridge.** The workspace's `js/vault.js` replaces upstream's direct IndexedDB access with `postMessage` to the parent. Protocol (all messages same-origin checked on both sides, and `event.source` checked against the frame's `contentWindow` / `window.parent`): the frame posts `ledger-redaction-ready` on load; the parent may reply with `ledger-redaction-file` carrying a `File`; the frame posts `ledger-redaction-request` `{ id, action: 'load'|'save', config }` and the parent (`DocumentRedaction`) answers `ledger-redaction-response` `{ id, config, persisted, status }` or `{ id, error }`. Requests time out after 15 s. When the workspace is opened standalone (no parent), the same module falls back to calling `profile.js` directly.

**Detection policy (`statement.js`).** `detectStatementCandidates` runs the upstream `runDetection` with the saved values + session values + pattern toggles, and injects `libphonenumber` from the global (loaded as a classic script in `index.html`) if present. It adds one ledger-specific detector on top: **labelled account numbers** (`Account: 003-1234567`, `Card #…`) — arbitrary digit runs are deliberately *not* matched because they collide with dates and amounts. `reviewStatement` is the one-call wrapper (`detect → finalizeSpans → applyToText`) used by both the Upload preview and `RedactionReview`; `disabledKeys` carries the user's unchecked spans.

**Licensing.** MuPDF is **AGPL-3.0**; the decision (Sept 2026) was to keep it, because the repo is public and the obligation is already met. If the app ever needs to go closed-source, MuPDF must be replaced (PDF.js render + pdf-lib image-only rebuild is the permissive route). Keep the notices under `src/redaction/vendor/` and the README's third-party licence paragraph intact when touching vendored files; bump `VERSIONS.json` on upgrade.

**Tests.** `tests/redaction/*.test.mjs` use Node's built-in runner and the real vendored MuPDF (they re-extract text from exported PDFs to prove content was removed). `tests/redaction/fixtures/minipdf.mjs` builds tiny synthetic PDFs so no real statements are needed. Add a test here for any change to the engine, vault, or statement policy.

## Development workflow

ES modules are blocked on `file://`, so a local server is required:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Edit any file under `src/` and reload — no build step. Use browser DevTools for debugging. To test a converter against real data, drop a CSV into the Upload view and pick the matching institution.

The redaction module has automated tests (Node 22+, no `npm install`):

```sh
node --experimental-default-type=module --test tests/redaction/*.mjs
```

The finance engine (`converter.js`, `categorizer.js`) currently has no tests; if you add some, use the same runner and directory convention (`tests/<area>/*.test.mjs`).

## Key institutions (built-in converters)

TD (chequing CSV + Visa CSV + Aeroplan Visa PDF + Business Chequing PDF), RBC (chequing CSV + Visa PDF statement), Amex (CSV + Platinum PDF statement), BMO (Interest Chequing PDF), plus a generic CSV fallback — all Canadian. RBC Visa PDF (`rbc_visa_pdf_v1`) relies on `period_regex` for every statement because transaction lines only carry `MMM DD`; the regex handles both RBC header variants (single-year `FROM JUN 10 TO JUL 9, 2025` and year-crossing `FROM DEC 10, 2024 TO JAN 09, 2025`). The `line_regex` ends with `(?:\s+.*)?$` rather than anchoring the amount to end-of-line because `pdfToText` clusters items by `Math.round(y)`, which can merge the right-side "IMPORTANT INFORMATION" panel (Credit limit, Available credit, etc.) into transaction rows — the trailing-junk tolerance plus non-greedy description capture ensures the FIRST `$X.XX` on the line wins.

Amex Platinum PDF (`amex_platinum_pdf_v1`) is the same shape but with two twists: (1) the signed amount prints on its OWN line below the date/description row (handled via `next_line_amount_regex`), and (2) the period header is just two padded `MMM DD, YYYY` dates back-to-back next to the account number (no "STATEMENT FROM" preamble), so its `period_regex` matches that pair directly. Transaction-row dates print as `MMM D` (single-digit days unpadded), distinct from the header's `MMM DD,`. Charges are positive and payments are negative in the raw text — `amount_sign: flipped` normalizes them.

TD Aeroplan Visa PDF (`td_aeroplan_visa_pdf_v1`) follows RBC's one-line row shape (transaction date / posted date / description / signed amount) with Amex's unpadded `MMM D` days. Its period header `STATEMENT PERIOD: April 09, 2026 to May 08, 2026` uses full month names, which `buildYearResolver` handles by slicing to the first three letters (`April` → `APR`). The `totals` entry validates the printed `Sub-total $X.XX` (charges + fees for the period) against the negative-signed sum after flip; the payments side isn't validated because TD prints the magnitude only, which the engine's flip would land on the wrong sign for a positive-sum comparison.

TD Business Chequing PDF (`td_business_chequing_pdf_v1`) was the first built-in using `layout: "columns"`. The statement is a true table where debit vs credit is determined by column position, not text — `IN261 TFR-TO C/C 75.42 FEB20` (debit) and a hypothetical `BUSINESS DEPOSIT 75.42 FEB20` (credit) look identical as joined text but sit in different x-coord columns. The column ranges (description / debit / credit / date / balance) were measured from a sample statement. Date column prints `JAN30` / `FEB20` with no whitespace, parsed via `MMMDD` format. Period header is compact `JAN 30/26 - FEB 27/26` with 2-digit years.

BMO Interest Chequing PDF (`bmo_interest_chequing_pdf_v1`) is the second columns-layout converter and the first that uses `account_section_regex` + `merge_continuation_rows`. BMO's Everyday Banking statement bundles Primary Chequing and Interest Chequing in one file, so the converter scopes to the Interest section (account ending `8157-971`) and treats `Closing totals` as the section end. The section header's "Interest Chequing Account # 0493 8157-971" appears as one Y-row in the transaction body but is split across Y-rows in the page-1 summary table — anchoring the start regex on the joined fragment skips the summary cleanly. Wrapped detail rows (`MSP/DIV`, `PAY/PAY`, `INS/ASS`, `FEE/FRA`) get folded back into the previous transaction via `merge_continuation_rows`. The period header `For the period ending April 17, 2026` prints only the end date, handled by the resolver's end-date-only fallback. Totals are validated via the summary-table row for `8157-971` (deducted + added columns), anchored on the account number to avoid the Primary section.

The `KNOWN_INSTITUTIONS` constant controls the institution picker dropdown. To upgrade a built-in's stored spec for existing users, add an entry to `migrateBuiltinSpecs` (called from `seedBuiltins`) that matches on the exact old value and rewrites in place — keep it idempotent so re-runs are no-ops.

## Upload auto-detect (filename reuse)

When a file is dropped in `UploadView`, `findReuseHint(filename)` looks up past uploads. Exact filename match wins; otherwise `normalizeFilenameForMatch` strips extensions, dates (full ISO, MDY, YYYY-MM), month names, and 4+ digit runs to collapse monthly-statement variants (e.g. `Visa Statement-6503 2025-01-09.pdf` and `…2025-02-09.pdf` both normalize to `visa statement`). On a hit, institution/account-type/account-name are prefilled and a callout offers one-click reuse. Normalizer is intentionally conservative — false negative is fine (manual picker is still there); false positive would reuse the wrong converter.
