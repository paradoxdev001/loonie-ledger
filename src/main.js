import html from './html.js';
import { useState, useEffect, useReducer } from './react.js';
import { AppContext, initialState, reducer } from './state.js';
import { initDB, seedBuiltins, STORE } from './db/store.js';
import { Header, Footer } from './components/Layout.js';
import { Toast, Card, Button } from './components/ui/index.js';
import { UploadView } from './components/Upload.js';
import { ReviewView } from './components/Review.js';
import { TransactionsView } from './components/Transactions.js';
import { ReportsView } from './components/Reports.js';
import { HistoryView } from './components/History.js';
import { ConvertersView } from './components/Converters.js';
import { SettingsView } from './components/Settings.js';
import { HomeView } from './components/Home.js';

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [bootError, setBootError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        await initDB();
        await seedBuiltins();
        const defaultView = STORE.transactions.length > 0 ? 'reports' : 'home';
        dispatch({ type: 'SET_READY', view: defaultView });
      } catch (e) {
        console.error(e);
        setBootError(e.message);
      }
    })();
  }, []);

  if (bootError) {
    return html`<div class="min-h-screen flex items-center justify-center p-6">
      <${Card} className="max-w-md p-6">
        <div class="text-plum font-semibold mb-2">Failed to initialize</div>
        <div class="text-sm text-ink-2">${bootError}</div>
        <${Button} className="mt-4" onClick=${() => location.reload()}>Reload</${Button}>
      </${Card}>
    </div>`;
  }

  if (!state.ready) {
    return html`<div class="min-h-screen flex items-center justify-center">
      <div class="text-ink-mute text-sm">Loading…</div>
    </div>`;
  }

  const ctx = { state, dispatch };

  return html`<${AppContext.Provider} value=${ctx}>
    <${Header} />
    ${state.view === 'home' && html`<${HomeView} />`}
    ${state.view === 'upload' && html`<${UploadView} />`}
    ${state.view === 'review' && html`<${ReviewView} />`}
    ${state.view === 'transactions' && html`<${TransactionsView} />`}
    ${state.view === 'reports' && html`<${ReportsView} />`}
    ${state.view === 'history' && html`<${HistoryView} />`}
    ${state.view === 'converters' && html`<${ConvertersView} />`}
    ${state.view === 'settings' && html`<${SettingsView} />`}
    <${Toast} toast=${state.toast} onClose=${() => dispatch({ type: 'CLEAR_TOAST' })} />
    <${Footer} />
  </${AppContext.Provider}>`;
}

window.ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
