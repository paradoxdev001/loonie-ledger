import html from '../html.js';
import { useState } from '../react.js';
import { useApp } from '../state.js';
import { STORAGE_MODE } from '../db/store.js';
import { classNames } from '../utils.js';

export function Header() {
  const { state, dispatch } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const tabs = [
    { key: 'upload',       label: 'Upload' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'reports',      label: 'Reports' },
    { key: 'history',      label: 'History' },
    { key: 'converters',   label: 'Converters' },
    { key: 'settings',     label: 'Settings' },
    { key: 'help',         label: 'Help' },
  ];

  const allTabs = state.pendingReview
    ? [...tabs, { key: 'review', label: `Review (${state.pendingReview.transactions.length})`, pending: true }]
    : tabs;

  const navigate = (key) => {
    dispatch({ type: 'SET_VIEW', view: key });
    setMobileOpen(false);
  };

  return html`<header class="bg-paper border-b border-rule-soft sticky top-0 z-30">
    ${STORAGE_MODE === 'memory' && html`<div class="bg-butter border-b border-rule px-4 py-2 text-xs text-ink text-center font-mono uppercase tracking-widest">
      Working in memory — use Export in Settings to save your data
    </div>`}
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">

        <button onClick=${() => navigate('home')} class="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <img src=${window.LOGO_URI} alt="Loonie Ledger" class="w-auto" style=${{ height: '52px' }} />
          <span class="font-serif text-xl text-ink tracking-tight leading-none">
            Loonie <em class="italic text-maple-deep">Ledger</em>
          </span>
        </button>

        <nav class="hidden sm:flex items-center gap-1">
          ${allTabs.map(t => html`<button
            key=${t.key}
            onClick=${() => navigate(t.key)}
            class=${classNames(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-all border',
              t.pending
                ? (state.view === t.key
                    ? 'bg-butter text-ink border-transparent'
                    : 'bg-paper-3 text-ink-2 border-rule hover:text-ink')
                : (state.view === t.key
                    ? 'bg-ink text-paper border-transparent'
                    : 'text-ink-2 border-transparent hover:border-rule hover:text-ink')
            )}
          >${t.label}</button>`)}
        </nav>

        <button
          class="sm:hidden p-2 rounded-full text-ink-2 hover:bg-paper-3 transition-colors"
          onClick=${() => setMobileOpen(o => !o)}
          aria-label="Menu"
        >
          ${mobileOpen
            ? html`<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`
            : html`<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>`
          }
        </button>
      </div>
    </div>

    ${mobileOpen && html`<div class="sm:hidden border-t border-rule-soft bg-paper">
      ${allTabs.map(t => html`<button
        key=${t.key}
        onClick=${() => navigate(t.key)}
        class=${classNames(
          'w-full flex items-center px-5 py-3 text-sm transition-colors text-left border-b border-rule-soft',
          state.view === t.key
            ? 'font-semibold text-ink'
            : 'font-medium text-ink-2 hover:text-ink hover:bg-paper-3'
        )}
      >${t.label}</button>`)}
    </div>`}
  </header>`;
}

export function PageContainer({ children }) {
  return html`<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">${children}</main>`;
}

export function PageHeader({ title, description, action }) {
  return html`<div class="flex items-start justify-between mb-6">
    <div>
      <h1 class="font-serif font-normal text-ink text-3xl leading-tight" style=${{ letterSpacing: '-0.02em' }}>${title}</h1>
      ${description && html`<p class="text-sm text-ink-mute mt-1 max-w-2xl">${description}</p>`}
    </div>
    ${action}
  </div>`;
}

export function Footer() {
  return html`<footer class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 mt-12 border-t border-rule-soft">
    <p class="text-xs text-ink-mute font-mono uppercase tracking-widest">
      Local-only · ${STORAGE_MODE === 'idb' ? 'IndexedDB' : STORAGE_MODE === 'localstorage' ? 'localStorage' : 'In-memory (use Export to save)'} · No data leaves your machine
    </p>
  </footer>`;
}
