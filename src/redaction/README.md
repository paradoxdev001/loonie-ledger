# Local Redact inside Loonie Ledger

The original Local Redact 1.0.0 document workspace is retained under `workspace/`,
inside the Ledger navigation and statement-upload modal. It keeps paste/file
intake, synthetic sample, highlighted review, manual selection, per-match
exclusions, CSV columns, PDF page/text views, copy, exports and download fallback.
The workspace uses local vendored dependencies rather than CDN resources.

## Shared components

- `engine/`: upstream matching, detection, spans, tokenization, CSV and DOCX code.
- `pdf.js`: upstream MuPDF wrapper used for actual PDF content removal.
- `vault.js`: adapted AES-GCM/IndexedDB vault, under `loonieledger_redaction`.
  Writes wait for transaction completion; failed writes use an explicit session
  fallback, and unreadable saved data fails closed rather than returning no values.
- `profile.js`: common presets, preferences, loading and saving.
- `statement.js`: common detection policy and safe converter prompts/feedback.
- `workspace/js/vault.js`: origin- and source-checked bridge to the parent profile
  service, preserving even its session-only fallback. Standalone opening uses the
  same vault locally. Values are never included in converter prompts as a profile.
- React Settings and converter sample review share that profile service. The
  document workspace retains Local Redact's settings UI with the same fields.

The document iframe preserves the native review UI and its self-only CSP within
Ledger's shell; it is not a security boundary against the parent app's scripts.
The parent application still loads some libraries from CDNs. The vault is not
included in ledger JSON backups or ledger data resets; manage saved values in
Redaction settings. Browser storage is scoped to the exact origin (port included).
Existing Local Redact profiles on a different origin are not migrated automatically.

## Intentional adaptations

- Ledger colors/chrome and a visible Redact tab / Upload → Review full document.
- Shared preset tokens such as FIRST_NAME and LAST_NAME; custom labels set prefixes.
- Phone and anchored DOB detection default on; ambiguous US ZIP detection off.
  All switches remain editable. Labelled account numbers are an added detector.
- DOCX exports reset original part XML each time, so changing selections after an
  export cannot leave stale replacements behind. Changing matches also invalidates
  the previous download link.
- PDF acceptance matches Local Redact: readable text anywhere in the document
  is sufficient. Pages without text remain visible and are listed as unchanged
  by automatic redaction. Entirely textless PDFs still require OCR.

## Limits and verification

Unlisted names, embedded images, metadata and other text outside the supported
extractors are not comprehensively sanitized. Scanned pages and images need OCR,
which neither original Local Redact nor this integration provides. Review outputs.
Finance parsing uses original statements; redacted exports are copies for sharing.
AI category suggestions remain their separate description-sharing flow.

Run `node --experimental-default-type=module --test tests/redaction/*.mjs`.
Tests use the bundled real MuPDF engine, with re-extraction of exported PDFs.

The imported application code retains Local Redact's MIT license in `LICENSE`.
Bundled dependencies have separate licenses: MuPDF's license is in
`vendor/mupdf/LICENSE`; JSZip and libphonenumber notices are under `vendor/`.
See `vendor/VERSIONS.json` for the copied versions. Keep these notices and review
upstream changes before replacing the vendored files. No sibling-folder runtime
or test dependency is required.
