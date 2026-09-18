# Application review and Local Redact integration

Reviewed statement upload, converter selection, AI converter setup, transaction
categorization, persistence, privacy copy and the Local Redact engine.

## Implemented

Local Redact is now a document workspace within Loonie Ledger, not just a detector
in AI setup. Its original UI is hosted in a same-origin frame under the Redact tab,
with Ledger colors and a shared profile service. Upload → Review full document passes
the selected file directly into the workspace without another file selection.

| Local Redact feature | Integration |
| --- | --- |
| First name, last name, email, address, city, postal, phone | Settings → Redaction; same values in the workspace gear menu |
| Custom label/value pairs | Saved and applied automatically; labels determine token prefixes |
| Encrypted value vault | Adapted AES-GCM/IndexedDB storage, shared through the host profile service |
| Pattern switches | Preserved, with finance-oriented defaults and labelled account detection |
| Highlighted matches and category counts | Original workspace UI preserved |
| Toggle false positives / select missed text | Original review interactions preserved |
| Whole CSV columns | Original column selection and consistent cell tokens preserved |
| PDF page and text previews | Original MuPDF renderer and content-removal exporter preserved |
| DOCX, CSV, TXT exports | Same-format outputs with `_redacted` filenames preserved |
| Paste text / synthetic sample | Available directly from Redact |
| Clipboard / download fallback | Preserved |
| AI sample review | Uses the same profile; additional values can remain document-specific |

The profile persists separately from ledger data, is excluded from ledger backups,
and is managed separately from ledger resets. Original document files are not
stored. Navigating away closes the document workspace; saved values remain.

Additional fixes:

- Upload previews apply saved values automatically before displaying text. The
  original is behind an explicit reveal button. Loading/failure states hide the
  source, and stale file-selection results are discarded. Full extracted text is
  redacted before clipping the preview, avoiding partial identifiers at its cutoff.

- Original filenames, parsed rows, warning strings and exception details no longer
  bypass the initial AI sample review through validation follow-ups.
- DOCX exports start from original XML each time. Changing selections after an
  earlier export no longer retains stale redactions in the archive.
- Changing redaction choices invalidates the prior export/download fallback.
- Profiles wait for committed writes; unavailable storage is explicitly reported
  as session-only. Failed profile reads do not silently disable personal matching.
- PDFs with readable text are accepted even when other pages are blank or
  image-only, matching Local Redact. Textless pages are listed in the review and
  preserved in exports; entirely textless documents still require OCR.
- Removed the analytics hook, corrected privacy copy, and fixed the preview count.

## Remaining improvements, in priority order

1. **Expose failed saves prominently.** `src/db/store.js` catches persistence
   failures and logs them; localStorage failures switch to memory. A user could
   continue working without realizing changes will not survive a reload. Add a
   visible unsaved-data state, retry and backup action.
2. **Require review for first-time batch converter matches.**
   `detectConverterByContent` in `src/components/Upload.js` selects by parse count
   and errors. Batch upload then automatically imports clean results. A parser
   can extract plausible rows using the wrong amount/sign columns. Reserve
   automatic import for user-confirmed mappings and review new matches.
3. **Bundle browser dependencies locally.** `index.html` still loads React,
   Tailwind, PDF.js, PapaParse, Chart.js and htm from external sources. This limits
   offline startup and runs third-party code in the ledger's origin. Vendoring
   dependencies and adding a restrictive CSP would better match the privacy goal.
4. **Extend review to AI category suggestions.**
   `src/components/Transactions.js` shares uncategorized descriptions in its
   separate optional flow. Those descriptions can contain names or identifiers.
   Reuse the review component with stable row IDs so edited descriptions still
   map to original local transactions.

## Scope and validation

Full-document redaction and AI-sample review are separate uses of the same saved
profile. Finance parsing still uses original files to preserve accurate ledger
values. Edited full-document matches do not automatically modify AI-sample choices;
the user separately approves the actual sample sent to AI.

OCR, image redaction and comprehensive metadata sanitization are not implemented.
Unlisted names and other unstructured identifiers need review. The original app's
reversible token restoration and ML detection were roadmap items, not existing
features, and have not been added. Original Local Redact profiles on other local
URLs/ports are not automatically migrated into the new shared vault.

74 automated tests pass, including upstream detection, CSV/DOCX processing, real
MuPDF redaction/re-extraction, saved profiles, repeat DOCX export behavior, and
PDF review/export with blank and non-text pages alongside readable pages.
Browser checks with synthetic data verified saved names, email/address/custom
values, reload persistence, automatic tokens, bidirectional settings updates,
upload-to-workspace handoff, CSV column redaction, converter sample redaction,
PDF page preview and PDF output generation. No real financial documents or live
AI provider calls were used. The UI retains manual selection and DOCX review from
the original app; DOCX export is covered by automated archive round-trip testing.

Run: `node --experimental-default-type=module --test tests/redaction/*.mjs`

See `src/redaction/README.md` for module boundaries, upstream adaptations and
bundled dependency/license notices. The main Ledger shell still uses CDN libraries;
the embedded workspace's self-only CSP is not isolation from parent-page scripts.
