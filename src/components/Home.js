import html from '../html.js';
import { useApp } from '../state.js';
import { Button } from './ui/index.js';
import { PageContainer } from './Layout.js';

function FeatureTile({ icon, title, description }) {
  return html`<div class="bg-paper-2 rounded-xl border border-rule p-5 shadow-sm">
    <div class="text-2xl mb-3">${icon}</div>
    <h3 class="font-semibold text-ink text-sm mb-1">${title}</h3>
    <p class="text-xs text-ink-mute leading-relaxed">${description}</p>
  </div>`;
}

function Step({ number, title, description }) {
  return html`<div class="flex gap-4 items-start">
    <div class="flex-none w-8 h-8 rounded-full bg-maple text-ink text-sm font-bold flex items-center justify-center">${number}</div>
    <div>
      <div class="font-semibold text-ink text-sm">${title}</div>
      <div class="text-xs text-ink-mute mt-0.5 leading-relaxed">${description}</div>
    </div>
  </div>`;
}

export function HomeView() {
  const { dispatch } = useApp();
  const goToUpload = () => dispatch({ type: 'SET_VIEW', view: 'upload' });

  const features = [
    {
      icon: '🔒',
      title: 'Private by design',
      description: 'All data stays in your browser. No accounts, no cloud sync, no servers. Nothing leaves your machine.',
    },
    {
      icon: '🇨🇦',
      title: 'Canadian-first',
      description: 'Built-in support for TD, RBC, Amex, and BMO — the banks Canadians actually use.',
    },
    {
      icon: '📄',
      title: 'PDF & CSV support',
      description: 'Import directly from your bank\'s downloads — both spreadsheet exports and PDF statements are parsed automatically.',
    },
    {
      icon: '✨',
      title: 'AI converter setup',
      description: 'Don\'t see your bank? Use your own API key to generate a converter conversationally in minutes.',
    },
    {
      icon: '🔄',
      title: 'Smart deduplication',
      description: 'Re-import the same statement twice and nothing duplicates. Fingerprint-based matching keeps things clean.',
    },
    {
      icon: '📶',
      title: 'Works offline',
      description: 'Once loaded, no internet connection required. Your finances, available anywhere.',
    },
  ];

  const steps = [
    {
      number: '1',
      title: 'Download your statement',
      description: 'Log into your bank and download a CSV or PDF statement — the same way you always have.',
    },
    {
      number: '2',
      title: 'Drop it in',
      description: 'Drag and drop the file. Loonie Ledger detects your institution and parses the statement automatically.',
    },
    {
      number: '3',
      title: 'See your spending',
      description: 'Review transactions, set up categorization rules, and explore reports and charts across all your accounts.',
    },
  ];

  return html`<${PageContainer}>
    <div class="text-center py-16 sm:py-20">
      <h1 class="font-serif font-normal text-ink leading-tight" style=${{ fontSize: 'clamp(40px,6vw,72px)', letterSpacing: '-0.025em' }}>
        Your finances,${' '}<em class="italic text-maple-deep">on your terms.</em>
      </h1>
      <p class="mt-5 text-lg text-ink-2 max-w-2xl mx-auto leading-relaxed">
        Unlike apps that require bank-linking services, Loonie Ledger works directly from your downloaded bank and credit card statements.
        Your financial data stays on your computer — no broken connections, no third-party access, no subscription required.
      </p>
      <div class="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <${Button} size="lg" onClick=${goToUpload}>Get started — it's free</${Button}>
        <a
          href="https://github.com/paradoxdev001/loonie-ledger"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium bg-ink text-paper hover:bg-ink-2 transition-all border border-transparent"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
          Fully open source
        </a>
      </div>
    </div>

    <div class="mt-2 bg-paper-2 rounded-xl border border-rule p-6 sm:p-8 shadow-sm">
      <h2 class="text-base font-semibold text-ink mb-6">How it works</h2>
      <div class="space-y-6">
        ${steps.map(s => html`<${Step} key=${s.number} number=${s.number} title=${s.title} description=${s.description} />`)}
      </div>
    </div>

    <div class="mt-12">
      <h2 class="text-center text-base font-semibold text-ink-2 mb-5 uppercase tracking-wide">Everything you need, nothing you don't</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${features.map(f => html`<${FeatureTile} key=${f.title} icon=${f.icon} title=${f.title} description=${f.description} />`)}
      </div>
    </div>

    <div class="mt-10 text-center py-10 border-t border-rule">
      <p class="text-ink-mute text-sm mb-4">No sign-up. No subscription. No bank connections required.</p>
      <${Button} size="lg" onClick=${goToUpload}>Import your first statement</${Button}>
    </div>
  </${PageContainer}>`;
}
