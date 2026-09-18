import html from '../html.js';
import { useState, useMemo, useRef, useEffect } from '../react.js';
import { Button, Label } from './ui/index.js';
import { RedactionSettings } from './RedactionSettings.js';
import { loadProfile } from '../redaction/profile.js';
import { downloadBlob } from '../utils.js';
import { reviewStatement } from '../redaction/statement.js';

export function RedactionReview({ source, onReviewed, draft, standalone = false }) {
  const [custom, setCustom] = useState(draft?.custom || '');
  const [disabled, setDisabled] = useState(new Set(draft?.disabled || []));
  const [edited, setEdited] = useState(draft?.edited ?? null);
  const sourceRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadProfile().then(p => {
      if (!active) return;
      setProfile(p); setProfileError('');
      if (draft?.profileKey !== JSON.stringify(p)) { setEdited(null); setDisabled(new Set()); }
    }).catch(e => { if (active) setProfileError(e.message); });
    return () => { active = false; };
  }, [retry]);
  const result = useMemo(() => reviewStatement(source, custom, disabled, profile || {}), [source, custom, disabled, profile]);
  const output = edited ?? result.text;
  function addSelection() {
    const el = sourceRef.current;
    const value = source.slice(el.selectionStart, el.selectionEnd).trim();
    if (value) { setCustom(v => v ? v + '\n' + value : value); setEdited(null); }
  }
  if (!profile) return html`<div class="text-sm">${profileError || 'Loading saved redaction values…'}
    ${profileError && html`<${Button} onClick=${() => setRetry(n => n + 1)}>Retry</${Button}>`}</div>`;
  return html`<div class="space-y-4">
    <p class="text-sm text-ink-2">Local Redact applies your saved values and detection preferences in your browser. Review matches, add names, addresses or account numbers, then approve the text for sharing. Your original file and local transaction data stay intact.</p>
    <div class="rounded-lg bg-butter-soft border border-butter-line p-3 text-xs text-butter-deep">Automatic detection can miss personal information. Add names and street addresses to your saved values. Dates, merchants and amounts remain unless you remove them.</div>
    <div class="rounded border border-rule p-3 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm">${profile.values.length} saved personal value${profile.values.length === 1 ? '' : 's'} applied automatically</span>
        <${Button} variant="secondary" size="sm" onClick=${() => setSettingsOpen(v => !v)}>${settingsOpen ? 'Close settings' : 'Manage saved values'}</${Button}>
      </div>
      ${settingsOpen && html`<${RedactionSettings} onSaved=${p => {
        setProfile(p); setEdited(null); setDisabled(new Set()); setSettingsOpen(false);
      }} />`}
      <p class="text-xs text-ink-mute">These are the same values as Settings → Redaction. Saving changes regenerates this preview.</p>
    </div>
    <div>
      <${Label}>Additional values for this document — one per line</${Label}>
      <textarea aria-label="Personal values to redact" rows="3" class="w-full border border-rule rounded p-2 text-sm" value=${custom}
        placeholder="Full name, street address, account number…"
        onChange=${e => { setCustom(e.target.value); setEdited(null); }}></textarea>
      <p class="text-xs text-ink-mute">Matching values receive consistent tokens. These values are kept only for this review. Changing values or matches regenerates the preview and replaces manual edits.</p>
    </div>
    <details>
      <summary class="cursor-pointer text-sm text-maple-deep">View original sample / select text to redact</summary>
      <textarea ref=${sourceRef} aria-label="Original statement sample" readOnly value=${source} rows="8" class="mt-2 w-full font-mono text-xs border border-rule rounded p-2"></textarea>
      <${Button} variant="secondary" size="sm" onClick=${addSelection}>Redact selected value everywhere</${Button}>
    </details>
    <div>
      <${Label}>Detected matches (${result.spans.filter(s => s.enabled).length} selected)</${Label}>
      <div class="max-h-40 overflow-auto space-y-1 mt-1">
        ${result.spans.length ? result.spans.map(s => html`<label key=${s.key} class="flex items-center gap-2 text-xs p-2 border border-rule rounded">
          <input type="checkbox" checked=${s.enabled} onChange=${() => {
            setDisabled(prev => { const next = new Set(prev); next.has(s.key) ? next.delete(s.key) : next.add(s.key); return next; });
            setEdited(null);
          }} />
          <span class="font-medium">${s.label}</span><span class="break-all">${source.slice(s.start, s.end)}</span><span class="ml-auto font-mono">${s.token}</span>
        </label>`) : html`<p class="text-xs text-ink-mute">No automatic matches. Review the sample for names and other private information.</p>`}
      </div>
    </div>
    <div>
      <${Label}>Text to share — edit or remove anything else</${Label}>
      <textarea aria-label="Redacted statement sample" value=${output} onChange=${e => setEdited(e.target.value)} rows="10" class="w-full font-mono text-xs border border-rule rounded p-2"></textarea>
    </div>
    <div class="flex flex-wrap gap-2">
      <${Button} variant="secondary" disabled=${!output.trim() || settingsOpen} onClick=${() => downloadBlob(output, 'redacted-statement.txt', 'text/plain;charset=utf-8')}>Download redacted text</${Button}>
      <${Button} disabled=${!output.trim() || settingsOpen} onClick=${() => onReviewed(output, { custom, disabled: [...disabled], edited, profileKey: JSON.stringify(profile) })}>${standalone ? 'Done' : 'Approve sample & continue'}</${Button}>
    </div>
    <p class="text-xs text-ink-mute">${standalone ? 'This preview covers the extracted document text. Download saves a text copy; local finance imports still use the original file.' : 'Nothing is sent by approving. Next, choose API or clipboard.'} This does not create a redacted PDF.</p>
  </div>`;
}
