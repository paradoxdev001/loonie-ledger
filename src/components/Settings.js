import html from '../html.js';
import { useState, useRef } from '../react.js';
import { useApp } from '../state.js';
import { dao } from '../db/store.js';
import { seedBuiltins } from '../db/store.js';
import { downloadBlob, setDateFormat } from '../utils.js';
import { Button, Card, CardHeader } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

export function SettingsView() {
  const { dispatch } = useApp();
  const fileRef = useRef(null);
  const [dateFmt, setDateFmt] = useState(() => localStorage.getItem('loonieledger_date_format') || 'iso');

  const onDateFormat = (fmt) => {
    setDateFormat(fmt);
    setDateFmt(fmt);
    dispatch({ type: 'REFRESH' });
  };

  const exportDB = () => {
    const data = dao.exportDB();
    downloadBlob(data, 'loonie-ledger-backup.json', 'application/json');
  };

  const importDB = async (file) => {
    if (!file) return;
    if (!confirm('Replace all data with this backup file?')) return;
    const buf = await file.arrayBuffer();
    try {
      await dao.importDB(new Uint8Array(buf));
      dispatch({ type: 'REFRESH' });
      dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'Backup imported' } });
    } catch (e) {
      dispatch({ type: 'TOAST', toast: { kind: 'error', message: 'Import failed: ' + e.message } });
    }
  };

  const resetAll = async () => {
    if (!confirm('Delete ALL transactions, accounts, history, and custom converters? Built-in converters will be restored. This cannot be undone.')) return;
    await dao.resetAll();
    await seedBuiltins();
    dispatch({ type: 'REFRESH' });
    dispatch({ type: 'TOAST', toast: { kind: 'success', message: 'All data cleared' } });
  };

  return html`<${PageContainer}>
    <${PageHeader}
      title="Settings"
      description="App preferences and data management."
    />

    <div class="space-y-6">
      <${Card}>
        <${CardHeader} title="Display" />
        <div class="px-4 pb-4">
          <div class="text-sm font-medium text-slate-700 mb-2">Date format</div>
          <div class="flex gap-6">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="dateFmt" value="iso"
                checked=${dateFmt === 'iso'}
                onChange=${() => onDateFormat('iso')} />
              <span class="text-sm text-slate-700">ISO  <code class="text-xs bg-slate-100 px-1.5 py-0.5 rounded">2025-05-31</code></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="dateFmt" value="friendly"
                checked=${dateFmt === 'friendly'}
                onChange=${() => onDateFormat('friendly')} />
              <span class="text-sm text-slate-700">Friendly  <code class="text-xs bg-slate-100 px-1.5 py-0.5 rounded">May 31st, 2025</code></span>
            </label>
          </div>
        </div>
      </${Card}>

      <${Card}>
        <${CardHeader} title="Data" />
        <div class="divide-y divide-slate-100">
          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <div class="text-sm font-medium text-slate-800">Export backup</div>
              <div class="text-xs text-slate-500 mt-0.5">Download all transactions, accounts, and converters as a JSON file.</div>
            </div>
            <${Button} variant="secondary" size="sm" onClick=${exportDB}>Export</${Button}>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <div class="text-sm font-medium text-slate-800">Import backup</div>
              <div class="text-xs text-slate-500 mt-0.5">Replace all data with a previously exported backup file.</div>
            </div>
            <input ref=${fileRef} type="file" accept=".json" class="hidden"
              onChange=${e => { importDB(e.target.files[0]); e.target.value = ''; }} />
            <${Button} variant="ghost" size="sm" onClick=${() => fileRef.current?.click()}>Import</${Button}>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <div class="text-sm font-medium text-red-700">Factory reset</div>
              <div class="text-xs text-slate-500 mt-0.5">Delete all transactions, accounts, history, and custom converters. Built-in converters are restored.</div>
            </div>
            <${Button} variant="danger" size="sm" onClick=${resetAll}>Reset</${Button}>
          </div>
        </div>
      </${Card}>
    </div>
  </${PageContainer}>`;
}
