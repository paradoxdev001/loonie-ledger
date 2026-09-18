// Encrypted value vault (design §10). The stored configuration contains the
// user's most sensitive identifiers in one place — a juicier target than any
// single document — so it is encrypted at rest with AES-GCM. The key is a
// NON-EXTRACTABLE WebCrypto CryptoKey stored in IndexedDB: raw key bytes cannot be exported through WebCrypto. Scripts in this origin
// can still use the key to decrypt, so this does not isolate data from page scripts. Nothing ever syncs.
//
// If IndexedDB or WebCrypto is unavailable (e.g. a sandboxed demo iframe),
// the vault degrades to in-memory only: nothing persists, and the UI says so.

const DB_NAME = 'loonieledger_redaction';
const DB_VERSION = 1;

let db = null;
let cryptoKey = null;
let persisted = false;
let memoryConfig = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys');
      if (!d.objectStoreNames.contains('vault')) d.createObjectStore('vault');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Vault transaction aborted'));
  });
}

function idbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Vault transaction aborted'));
  });
}

async function getOrCreateKey() {
  let key = await idbGet('keys', 'vault-key');
  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // NON-extractable: key material never exposed to JS
      ['encrypt', 'decrypt']
    );
    await idbPut('keys', 'vault-key', key);
  }
  return key;
}

export async function initVault() {
  try {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error('unavailable');
    db = await openDb();
    cryptoKey = await getOrCreateKey();
    persisted = true;
  } catch {
    persisted = false;
  }
  return vaultStatus();
}

export function vaultStatus() {
  return { persisted, encrypted: persisted };
}

export async function loadVaultConfig() {
  if (!persisted) return memoryConfig;
  try {
    const rec = await idbGet('vault', 'config');
    if (!rec) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, cryptoKey, rec.ct);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Saved redaction values could not be read. Retry before continuing.');
  }
}

export async function saveVaultConfig(config) {
  memoryConfig = config;
  if (!persisted) return false;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(JSON.stringify(config))
    );
    await idbPut('vault', 'config', { iv, ct });
    return true;
  } catch {
    // Keep this session on the new config rather than silently loading old values.
    persisted = false;
    return false;
  }
}

export async function eraseVault() {
  return saveVaultConfig({ version: 1, values: [], patterns: {} });
}
