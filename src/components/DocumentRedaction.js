import html from '../html.js';
import { useRef, useEffect, useState } from '../react.js';
import { loadProfile, saveProfile, vaultStatus } from '../redaction/profile.js';
import { PageContainer, PageHeader } from './Layout.js';

// Local Redact's existing document UI stays intact within the Ledger shell.
// Its profile requests use the same service as Settings and converter reviews.
export function DocumentRedaction({ file = null }) {
  const frame = useRef(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    async function receive(event) {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.type === 'ledger-redaction-ready') {
        setReady(true);
        if (file) event.source.postMessage({ type: 'ledger-redaction-file', file }, location.origin);
      }
      if (data?.type !== 'ledger-redaction-request' || !['load', 'save'].includes(data.action)) return;
      try {
        const persisted = data.action === 'save' ? await saveProfile(data.config) : undefined;
        const config = await loadProfile();
        if (active) event.source.postMessage({ type: 'ledger-redaction-response', id: data.id, config, persisted, status: vaultStatus() }, location.origin);
      } catch (e) {
        if (active) { setFailure(e.message); event.source.postMessage({ type: 'ledger-redaction-response', id: data.id, error: e.message }, location.origin); }
      }
    }
    window.addEventListener('message', receive);
    return () => { active = false; window.removeEventListener('message', receive); };
  }, [file]);
  return html`<div>
    ${failure && html`<p role="alert" class="text-sm text-plum p-3">${failure}</p>`}
    ${!ready && !failure && html`<p class="text-xs text-ink-mute p-2">Loading document redaction…</p>`}
    <iframe ref=${frame} title="Document redaction workspace" src="src/redaction/workspace/index.html"
      class="w-full border border-rule rounded-lg" style=${{ height: '76vh', minHeight: '480px', background: '#f6f1e5' }}></iframe>
  </div>`;
}

export function RedactionView() {
  return html`<${PageContainer}>
    <${PageHeader} title="Redact documents" description="Local Redact, built into your ledger. Review and export TXT, CSV, DOCX or text-based PDF files using your saved personal values." />
    <${DocumentRedaction} />
  </${PageContainer}>`;
}
