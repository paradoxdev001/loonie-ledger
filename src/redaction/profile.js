import { initVault, loadVaultConfig, saveVaultConfig, vaultStatus } from './vault.js';
import { sanitizePrefix } from './engine/tokenize.js';
import { defaultPatternToggles } from './engine/patterns.js';

export const PRESETS = [
  { key: 'firstName', label: 'First name', prefix: 'FIRST_NAME' },
  { key: 'lastName', label: 'Last name', prefix: 'LAST_NAME' },
  { key: 'email', label: 'Email address', prefix: 'EMAIL' },
  { key: 'address', label: 'Street address', prefix: 'ADDRESS' },
  { key: 'city', label: 'City', prefix: 'CITY' },
  { key: 'postal', label: 'Postal / ZIP code', prefix: 'POSTAL' },
  { key: 'phone', label: 'Phone number', prefix: 'PHONE' }
];

export function normalizeProfile(config = {}) {
  return {
    version: 1,
    values: (config.values || []).filter(v => typeof v.value === 'string' && v.value.trim())
      .map(v => ({ id: String(v.id), label: v.label?.trim() || 'Custom value', value: v.value.trim(),
        tokenPrefix: sanitizePrefix(v.tokenPrefix || v.label) })),
    patterns: { ...defaultPatternToggles(), phone: true, dob: true, zip_us: false, account: true, ...config.patterns }
  };
}

let ready;
const initialize = () => ready ||= initVault();
export async function loadProfile() {
  await initialize();
  return normalizeProfile(await loadVaultConfig() || {});
}
export async function saveProfile(profile) {
  await initialize();
  return saveVaultConfig(normalizeProfile(profile));
}
export { vaultStatus };
