import html from '../html.js';
import { useEffect, useState } from '../react.js';
import { Button, Input } from './ui/index.js';
import { PRESETS, loadProfile, saveProfile, normalizeProfile, vaultStatus } from '../redaction/profile.js';
import { CATEGORY_META } from '../redaction/engine/patterns.js';
import { sanitizePrefix } from '../redaction/engine/tokenize.js';
import { isDangerouslyShort } from '../redaction/engine/denylist.js';

export function RedactionSettings({ onSaved }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadProfile().then(p => { if (active) { setProfile(p); setError(''); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [retry]);
  function update(id, patch) {
    setStatus('');
    setProfile(p => ({ ...p, values: p.values.some(v => v.id === id)
      ? p.values.map(v => v.id === id ? { ...v, ...patch } : v)
      : [...p.values, { id, ...patch }] }));
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const next = normalizeProfile(profile);
      const persistent = await saveProfile(next);
      setProfile(next);
      setStatus(persistent ? 'Saved on this device. These values will apply automatically to your next review.'
        : 'Saved for this session only. Browser storage is unavailable; keep this page open.');
      onSaved?.(next);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!profile) return html`<div class="p-4 text-sm">${error || 'Loading redaction settings…'}
    ${error && html`<${Button} onClick=${() => setRetry(n => n + 1)}>Retry</${Button}>`}</div>`;
  const custom = profile.values.filter(v => !PRESETS.some(p => v.id === 'p:' + p.key));
  return html`<div class="space-y-4">
    <p class="text-sm text-ink-2">Enter your personal values once. Local Redact replaces matching text with tokens such as [FIRST_NAME_1] and [EMAIL_1] whenever you review a statement. Matching ignores letter case and recognizes common number formats.</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${PRESETS.map(p => {
        const value = profile.values.find(v => v.id === 'p:' + p.key)?.value || '';
        return html`<label key=${p.key} class="block text-sm">${p.label}
          <${Input} aria-label=${p.label} autoComplete="off" value=${value} disabled=${busy}
            onChange=${e => update('p:' + p.key, { value: e.target.value, label: p.label, tokenPrefix: p.prefix })} />
          ${value && isDangerouslyShort(value) && html`<span class="text-xs text-butter-deep">Short values may also match unrelated text. Check the preview.</span>`}
        </label>`;
      })}
    </div>
    <div class="space-y-2">
      <p class="text-sm font-medium">Custom label / value pairs</p>
      ${custom.map((v, i) => html`<div key=${v.id} class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
        <${Input} aria-label=${'Custom label ' + (i + 1)} placeholder="Label, e.g. Account number" value=${v.label || ''} disabled=${busy}
          onChange=${e => update(v.id, { label: e.target.value, tokenPrefix: sanitizePrefix(e.target.value) })} />
        <${Input} aria-label=${'Custom value ' + (i + 1)} placeholder="Value to redact" autoComplete="off" value=${v.value || ''} disabled=${busy}
          onChange=${e => update(v.id, { value: e.target.value })} />
        <${Button} variant="ghost" size="sm" disabled=${busy} onClick=${() => { setStatus(''); setProfile(p => ({ ...p, values: p.values.filter(x => x.id !== v.id) })); }}>Remove</${Button}>
      </div>`)}
      <${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => update('c:' + crypto.randomUUID(), { label: '', value: '' })}>Add name/value pair</${Button}>
      <p class="text-xs text-ink-mute">Custom labels become token names: “Account number” → [ACCOUNT_NUMBER_1]. Remove a row or blank a field, then save to stop matching it.</p>
    </div>
    <details>
      <summary class="text-sm text-maple-deep cursor-pointer">Automatic detection preferences</summary>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        ${Object.entries({ ...CATEGORY_META, account: { label: 'Labelled account numbers' } }).map(([key, meta]) => html`<label key=${key} class="flex gap-2 text-sm items-center">
          <input type="checkbox" checked=${profile.patterns[key]} disabled=${busy} onChange=${e => {
            const checked = e.target.checked; setStatus(''); setProfile(p => ({ ...p, patterns: { ...p.patterns, [key]: checked } }));
          }} />${meta.label}
        </label>`)}
      </div>
    </details>
    <p class="text-xs text-ink-mute">${vaultStatus().persisted ? 'Saved values are encrypted in this browser and excluded from ledger backups. The encryption key lives in the same browser; this does not protect against scripts running in this app.' : 'Persistent storage is unavailable. Values will be kept for this session only.'} Keep using the same browser and local URL (including port) to access your saved profile.</p>
    ${error && html`<p role="alert" class="text-sm text-plum">${error}</p>`}
    ${status && html`<p role="status" class="text-sm text-forest">${status}</p>`}
    <${Button} onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save redaction settings'}</${Button}>
  </div>`;
}
