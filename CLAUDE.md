# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A local-only household finance tracker split into native ES modules under `src/`. No build step, no npm, no bundler. Libraries (React 18, PapaParse, PDF.js, Chart.js, Tailwind) are loaded from CDN as UMD globals. JSX is replaced with **htm** tagged template literals. The CSV sample file `download-transactions.csv` is a test fixture for the RBC Visa converter.

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
| `src/engine/categorizer.js` | `autoCategorize`, `extractMerchant`, `inferTxnType`, `DEFAULT_RULES` |
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

### Data model

Five in-memory tables (persisted as one JSON blob under key `state_v1`):

- **accounts** — `{ id, institution, account_name, account_type, currency }` — unique on `(institution, account_name)`
- **converters** — `{ id, key, name, institution, account_type, format, spec_json, is_builtin }` — unique on `key`
- **documents** — `{ id, filename, format, institution, account_id, converter_id, status }` — upload history
- **transactions** — `{ id, document_id, account_id, transaction_date, amount, description, category, transaction_type, fingerprint }` — deduplicated on `(account_id, fingerprint)`
- **category_rules** — `{ id, pattern, match_type, category, priority }` — applied in priority order

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

### Persistence

`detectStorageMode()` tries IndexedDB → localStorage → in-memory on startup. The entire `STORE` object is serialized as one blob. `persistDB()` is debounced 200 ms; `persistNow()` is immediate. Export/import is available via the UI (produces the raw JSON).

### AI-assisted converter authoring

Alongside the heuristic Bootstrap Wizard, users can author a converter conversationally. `ConverterMatchPanel` offers "✨ Set up with AI" (no-converter case and the "none match?" line), which opens `AIConverterWizard`. The model's **only** output is a converter spec JSON — the same shape Module 3 consumes — so it never sees transaction data and any structured-output-capable model works. Parsing stays 100% deterministic.

**Provider adapter (Module 1.5):** `callLLM({ provider, apiKey, model, messages })` normalizes two providers to `{ spec, text }`. Anthropic forces structured output via **tool use** (`tool_choice` on `emit_converter_spec`); OpenAI uses **`response_format: json_schema`** (left non-strict on purpose — `SPEC_JSON_SCHEMA` is permissive with optional fields + `additionalProperties: true`, which strict mode forbids). Both share `SPEC_JSON_SCHEMA` and `LLM_SYSTEM_PROMPT` (an abbreviated copy of this spec doc). Defaults are top-tier per provider: Anthropic `claude-sonnet-4-6`, OpenAI `gpt-4o` (no model picker UI yet — edit `LLM_PROVIDERS` to change). Keys live in `localStorage` (`loonieledger_llm_provider`, `loonieledger_llm_key_anthropic`, `loonieledger_llm_key_openai`) via `getLLMConfig`/`setLLMConfig`, **never** in `STORE`, so they're excluded from DB exports.

**Browser-direct calls:** both providers normally block browser requests via CORS. Anthropic is opted-in with the `anthropic-dangerous-direct-browser-access: true` header; OpenAI just needs the `Authorization` bearer. This is acceptable only because each user brings their own rotatable key (the danger the header guards against — leaking *your* key to *other people's* browsers — doesn't apply when the key owner is the only browser). A future server component would move the call server-side and drop the header.

**Wizard flow (`AIConverterWizard`):** extracts a document excerpt — for PDFs it sends `pdfToText` output **plus a `pdfToRows` x-coordinate sample** so `layout:"columns"` statements (TD Business, BMO) are solvable, since plain text loses the x-coords that distinguish debit vs. credit. It then runs an **auto-validation loop**: after each spec it calls `applyConverter` locally and feeds parse errors back to the model for up to 2 silent retries before handing control to the user. The user refines further in chat while watching `LivePreview`. Save gate is soft (`parsedCount > 0`, not zero-errors, since valid converters emit benign warnings). `normalizeWizardSpec()` folds the schema's `pdf_columns` array into `spec.columns` (what the engine reads) before validation/save. Saved specs are indistinguishable from manually-authored ones — fully deterministic from then on.

## Development workflow

ES modules are blocked on `file://`, so a local server is required:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Edit any file under `src/` and reload — no build step. Use browser DevTools for debugging. To test a converter against real data, drop a CSV into the Upload view and pick the matching institution.

## Key institutions (built-in converters)

TD (chequing CSV + Visa CSV + Aeroplan Visa PDF + Business Chequing PDF), RBC (chequing CSV + Visa PDF statement), Amex (CSV + Platinum PDF statement), BMO (Interest Chequing PDF), plus a generic CSV fallback — all Canadian. RBC Visa PDF (`rbc_visa_pdf_v1`) relies on `period_regex` for every statement because transaction lines only carry `MMM DD`; the regex handles both RBC header variants (single-year `FROM JUN 10 TO JUL 9, 2025` and year-crossing `FROM DEC 10, 2024 TO JAN 09, 2025`). The `line_regex` ends with `(?:\s+.*)?$` rather than anchoring the amount to end-of-line because `pdfToText` clusters items by `Math.round(y)`, which can merge the right-side "IMPORTANT INFORMATION" panel (Credit limit, Available credit, etc.) into transaction rows — the trailing-junk tolerance plus non-greedy description capture ensures the FIRST `$X.XX` on the line wins.

Amex Platinum PDF (`amex_platinum_pdf_v1`) is the same shape but with two twists: (1) the signed amount prints on its OWN line below the date/description row (handled via `next_line_amount_regex`), and (2) the period header is just two padded `MMM DD, YYYY` dates back-to-back next to the account number (no "STATEMENT FROM" preamble), so its `period_regex` matches that pair directly. Transaction-row dates print as `MMM D` (single-digit days unpadded), distinct from the header's `MMM DD,`. Charges are positive and payments are negative in the raw text — `amount_sign: flipped` normalizes them.

TD Aeroplan Visa PDF (`td_aeroplan_visa_pdf_v1`) follows RBC's one-line row shape (transaction date / posted date / description / signed amount) with Amex's unpadded `MMM D` days. Its period header `STATEMENT PERIOD: April 09, 2026 to May 08, 2026` uses full month names, which `buildYearResolver` handles by slicing to the first three letters (`April` → `APR`). The `totals` entry validates the printed `Sub-total $X.XX` (charges + fees for the period) against the negative-signed sum after flip; the payments side isn't validated because TD prints the magnitude only, which the engine's flip would land on the wrong sign for a positive-sum comparison.

TD Business Chequing PDF (`td_business_chequing_pdf_v1`) was the first built-in using `layout: "columns"`. The statement is a true table where debit vs credit is determined by column position, not text — `IN261 TFR-TO C/C 75.42 FEB20` (debit) and a hypothetical `BUSINESS DEPOSIT 75.42 FEB20` (credit) look identical as joined text but sit in different x-coord columns. The column ranges (description / debit / credit / date / balance) were measured from a sample statement. Date column prints `JAN30` / `FEB20` with no whitespace, parsed via `MMMDD` format. Period header is compact `JAN 30/26 - FEB 27/26` with 2-digit years.

BMO Interest Chequing PDF (`bmo_interest_chequing_pdf_v1`) is the second columns-layout converter and the first that uses `account_section_regex` + `merge_continuation_rows`. BMO's Everyday Banking statement bundles Primary Chequing and Interest Chequing in one file, so the converter scopes to the Interest section (account ending `8157-971`) and treats `Closing totals` as the section end. The section header's "Interest Chequing Account # 0493 8157-971" appears as one Y-row in the transaction body but is split across Y-rows in the page-1 summary table — anchoring the start regex on the joined fragment skips the summary cleanly. Wrapped detail rows (`MSP/DIV`, `PAY/PAY`, `INS/ASS`, `FEE/FRA`) get folded back into the previous transaction via `merge_continuation_rows`. The period header `For the period ending April 17, 2026` prints only the end date, handled by the resolver's end-date-only fallback. Totals are validated via the summary-table row for `8157-971` (deducted + added columns), anchored on the account number to avoid the Primary section.

The `KNOWN_INSTITUTIONS` constant controls the institution picker dropdown. To upgrade a built-in's stored spec for existing users, add an entry to `migrateBuiltinSpecs` (called from `seedBuiltins`) that matches on the exact old value and rewrites in place — keep it idempotent so re-runs are no-ops.

## Upload auto-detect (filename reuse)

When a file is dropped in `UploadView`, `findReuseHint(filename)` looks up past uploads. Exact filename match wins; otherwise `normalizeFilenameForMatch` strips extensions, dates (full ISO, MDY, YYYY-MM), month names, and 4+ digit runs to collapse monthly-statement variants (e.g. `Visa Statement-6503 2025-01-09.pdf` and `…2025-02-09.pdf` both normalize to `visa statement`). On a hit, institution/account-type/account-name are prefilled and a callout offers one-click reuse. Normalizer is intentionally conservative — false negative is fine (manual picker is still there); false positive would reuse the wrong converter.
