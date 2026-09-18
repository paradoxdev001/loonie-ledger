// The embedded workspace uses the host's profile service, including its
// session-only fallback. Messages are restricted to this frame's same-origin host.
import { loadProfile, saveProfile, vaultStatus as localStatus } from '../../profile.js';
let status = { persisted: false, encrypted: false };
let seq = 0;
const pending = new Map();
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== 'ledger-redaction-response') return;
  const task = pending.get(data.id);
  if (!task) return;
  pending.delete(data.id); clearTimeout(task.timer);
  data.error ? task.reject(new Error(data.error)) : task.resolve(data);
});
async function request(action, config) {
  if (window.parent === window) {
    if (action === 'save') {
      const persisted = await saveProfile(config);
      return { config, persisted, status: localStatus() };
    }
    return { config: await loadProfile(), status: localStatus() };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Redaction settings did not respond. Close and reopen the redaction workspace.')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ type: 'ledger-redaction-request', id, action, config }, location.origin);
  });
}
export async function initVault() {
  const result = await request('load'); status = result.status; return status;
}
export async function loadVaultConfig() {
  const result = await request('load'); status = result.status; return result.config;
}
export async function saveVaultConfig(config) {
  const result = await request('save', config); status = result.status; return result.persisted;
}
export async function eraseVault() {
  return saveVaultConfig({ version: 1, values: [], patterns: {} });
}
export function vaultStatus() { return status; }
export function notifyReady(onFile) {
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.type === 'ledger-redaction-file' && event.data.file instanceof File) onFile(event.data.file);
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'ledger-redaction-ready' }, location.origin);
}
