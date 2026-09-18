import html from '../html.js';
import { useEffect, useState } from '../react.js';
import { loadProfile } from '../redaction/profile.js';
import { reviewStatement } from '../redaction/statement.js';
import { Button } from './ui/index.js';

export function UploadPrivacyPreview({ source, loading, error, reviewOpen, onReview }) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null); setFailure(''); setShowOriginal(false);
    if (loading || error || !source) return;
    loadProfile().then(profile => {
      // Detect on the full extracted text before clipping the visible preview.
      const reviewed = reviewStatement(source, '', new Set(), profile);
      if (active) setResult({ source, text: reviewed.text, count: reviewed.spans.filter(s => s.enabled).length, saved: profile.values.length });
    }).catch(e => { if (active) setFailure(e.message); });
    return () => { active = false; };
  }, [source, loading, error, reviewOpen, retry]);
  const ready = result?.source === source && !loading && !error && !failure;
  return html`<div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-sm font-medium text-forest">1. Automatic redaction preview</div>
      <${Button} variant="secondary" size="sm" onClick=${onReview}>Review full document</${Button}>
    </div>
    ${error || failure ? html`<div role="alert" class="text-sm text-plum">${error || failure}
      <p class="text-xs mt-1">The preview is hidden because redaction could not finish.</p>
      ${failure && html`<${Button} variant="ghost" size="sm" onClick=${() => setRetry(n => n + 1)}>Retry redaction</${Button}>`}
    </div>` : !ready ? html`<p role="status" class="text-sm text-ink-mute">${!loading && !source ? 'No readable text to preview. Open the full document to inspect it.' : 'Reading statement and applying your saved redaction settings…'}</p>`
      : html`<div>
        <p role="status" class="text-xs text-forest mb-2">${result.count ? `${result.count} matches replaced automatically in the extracted text.` : 'No matches found automatically. Review the document for missed personal information.'}
          ${!result.saved && ' Add names and addresses in Settings → Redaction for automatic replacement.'}</p>
        <pre aria-label="Automatic redaction preview" class="text-xs bg-paper border border-rule rounded p-3 max-h-48 overflow-auto scrollbar-thin font-mono whitespace-pre-wrap">${result.text.slice(0, 2000)}</pre>
        <p class="text-xs text-ink-mute mt-2">This is an automatic preview, not a completed manual review. Review the full document to adjust matches and download a redacted copy. Local finance imports use the original file.</p>
        <button type="button" aria-expanded=${showOriginal} class="text-xs text-ink-mute underline mt-3" onClick=${() => setShowOriginal(v => !v)}>${showOriginal ? 'Hide original text' : 'Show original text (contains personal information)'}</button>
        ${showOriginal && html`<pre aria-label="Original statement text" class="mt-2 text-xs border border-rule rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap">${source.slice(0, 2000)}</pre>`}
      </div>`}
  </div>`;
}
