import html from '../html.js';
import { useState } from '../react.js';
import { useApp } from '../state.js';
import { STORAGE_MODE } from '../db/store.js';
import { classNames } from '../utils.js';

export function Header() {
  const { state, dispatch } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const tabs = [
    { key: 'upload', label: 'Upload', icon: '⬆' },
    { key: 'transactions', label: 'Transactions', icon: '☰' },
    { key: 'reports', label: 'Reports', icon: '📊' },
    { key: 'history', label: 'History', icon: '🗂' },
    { key: 'converters', label: 'Converters', icon: '⇄' },
    { key: 'settings', label: 'Settings', icon: '⚙' },
  ];

  const allTabs = state.pendingReview
    ? [...tabs, { key: 'review', label: `Review (${state.pendingReview.transactions.length})`, icon: '✏', pending: true }]
    : tabs;

  const navigate = (key) => {
    dispatch({ type: 'SET_VIEW', view: key });
    setMobileOpen(false);
  };

  return html`<header class="bg-white border-b border-slate-200 sticky top-0 z-30">
    ${STORAGE_MODE === 'memory' && html`<div class="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-center gap-2">
      <span>⚠</span>
      <span>Persistent storage unavailable in this context. Working in memory — use <span class="font-medium">↓ Export</span> in the header to save your data.</span>
    </div>`}
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <button onClick=${() => navigate('home')} class="flex items-center gap-2 rounded-lg hover:opacity-80 transition-opacity">
          <img src=${window.LOGO_URI} alt="Loonie Ledger illustration" class="w-auto" style=${{ height: '48px' }} />
          <div class="flex flex-col leading-tight">
            <span class="font-bold text-xl text-slate-800 tracking-tight">Loonie</span>
            <span class="font-bold text-xl tracking-tight" style=${{ color: '#1a9d8f' }}>Ledger</span>
          </div>
        </button>

        <!-- Desktop nav -->
        <nav class="hidden sm:flex items-center gap-1">
          ${allTabs.map(t => html`<button
            key=${t.key}
            onClick=${() => navigate(t.key)}
            class=${classNames(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              t.pending
                ? (state.view === t.key ? 'bg-amber-100 text-amber-800' : 'bg-amber-50 text-amber-700 hover:bg-amber-100')
                : (state.view === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
            )}
          ><span class="mr-1.5">${t.icon}</span>${t.label}</button>`)}
        </nav>

        <!-- Mobile hamburger -->
        <button
          class="sm:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
          onClick=${() => setMobileOpen(o => !o)}
          aria-label="Menu"
        >
          ${mobileOpen
            ? html`<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`
            : html`<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>`
          }
        </button>
      </div>
    </div>

    <!-- Mobile dropdown -->
    ${mobileOpen && html`<div class="sm:hidden border-t border-slate-200 bg-white">
      ${allTabs.map(t => html`<button
        key=${t.key}
        onClick=${() => navigate(t.key)}
        class=${classNames(
          'w-full flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors text-left',
          t.pending
            ? (state.view === t.key ? 'bg-amber-100 text-amber-800' : 'text-amber-700 hover:bg-amber-50')
            : (state.view === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50')
        )}
      >
        <span class="text-base">${t.icon}</span>
        <span>${t.label}</span>
      </button>`)}
    </div>`}
  </header>`;
}

export function PageContainer({ children }) {
  return html`<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">${children}</main>`;
}

export function PageHeader({ title, description, action }) {
  return html`<div class="flex items-start justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold text-slate-900">${title}</h1>
      ${description && html`<p class="text-sm text-slate-500 mt-1 max-w-2xl">${description}</p>`}
    </div>
    ${action}
  </div>`;
}

export function Footer() {
  return html`<footer class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-xs text-slate-400">
    Local-only · ${STORAGE_MODE === 'idb' ? 'IndexedDB' : STORAGE_MODE === 'localstorage' ? 'localStorage' : 'In-memory (use Export to save)'} · No data leaves your machine
  </footer>`;
}
