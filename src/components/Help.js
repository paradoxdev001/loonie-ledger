import html from '../html.js';
import { useEffect, useRef } from '../react.js';
import { useApp } from '../state.js';
import { Card } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

const SECTIONS = [
  { id: 'getting-started', title: 'Getting started' },
  { id: 'privacy',         title: 'Privacy & your data' },
  { id: 'uploads',         title: 'Uploading statements' },
  { id: 'converters',      title: 'Converters' },
  { id: 'ai-converters',   title: 'AI converter setup' },
  { id: 'review',          title: 'Reviewing before import' },
  { id: 'transactions',    title: 'Transactions' },
  { id: 'categorization',  title: 'Categories & rules' },
  { id: 'reports',         title: 'Reports' },
  { id: 'recurring',       title: 'Recurring charges' },
  { id: 'history',         title: 'Upload history' },
  { id: 'settings',        title: 'Settings' },
  { id: 'faq',             title: 'FAQ & troubleshooting' },
];

// --- small prose helpers (keep section markup readable) ---
function H({ children }) {
  return html`<h2 class="font-serif font-normal text-ink text-2xl leading-tight mb-3" style=${{ letterSpacing: '-0.02em' }}>${children}</h2>`;
}
function P({ children, className = '' }) {
  return html`<p class=${`text-sm text-ink-2 leading-relaxed ${className}`}>${children}</p>`;
}
function Sub({ children }) {
  return html`<h3 class="text-sm font-semibold text-ink mt-5 mb-1.5">${children}</h3>`;
}
function UL({ children }) {
  return html`<ul class="list-disc pl-5 space-y-1 text-sm text-ink-2 leading-relaxed">${children}</ul>`;
}
function C({ children }) {
  return html`<code class="text-xs bg-paper-3 text-ink px-1.5 py-0.5 rounded font-mono">${children}</code>`;
}
function Pre({ children }) {
  return html`<pre class="mt-2 text-xs bg-paper border border-rule rounded-lg p-3 overflow-auto scrollbar-thin font-mono whitespace-pre">${children}</pre>`;
}
function Note({ children, tone = 'butter' }) {
  const cls = tone === 'plum'
    ? 'bg-plum-soft border-plum-line text-plum-deep'
    : 'bg-butter-soft border-butter-line text-butter-deep';
  return html`<div class=${`rounded-lg border p-3 text-xs leading-relaxed my-3 ${cls}`}>${children}</div>`;
}

function Section({ id, title, children }) {
  return html`<section id=${id} class="scroll-mt-24 pb-10 mb-10 border-b border-rule-soft last:border-0 last:mb-0">
    <${H}>${title}</${H}>
    ${children}
  </section>`;
}

function TOC({ active, onJump }) {
  return html`<nav class="text-sm">
    <div class="text-xs font-semibold text-ink-mute uppercase tracking-widest mb-3">On this page</div>
    <ul class="space-y-0.5">
      ${SECTIONS.map(s => html`<li key=${s.id}>
        <button
          onClick=${() => onJump(s.id)}
          class=${`block w-full text-left px-2 py-1 rounded transition-colors ${
            active === s.id ? 'bg-paper-3 text-ink font-medium' : 'text-ink-2 hover:text-ink hover:bg-paper-3'
          }`}
        >${s.title}</button>
      </li>`)}
    </ul>
  </nav>`;
}

export function HelpView() {
  const { state, dispatch } = useApp();
  const anchor = state.helpAnchor;
  const scrolledFor = useRef(null);

  // Scroll the requested section into view once the view has rendered.
  useEffect(() => {
    if (!anchor) {
      window.scrollTo({ top: 0 });
      return;
    }
    if (scrolledFor.current === anchor) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(anchor);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); scrolledFor.current = anchor; }
    });
    return () => cancelAnimationFrame(id);
  }, [anchor]);

  const jump = (id) => dispatch({ type: 'SET_VIEW', view: 'help', anchor: id });

  return html`<${PageContainer}>
    <${PageHeader}
      title="Help"
      description="How Loonie Ledger works — from importing statements to teaching the AI a new bank format."
    />

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
      <aside class="lg:col-span-1">
        <div class="lg:sticky lg:top-20">
          <${TOC} active=${anchor} onJump=${jump} />
        </div>
      </aside>

      <div class="lg:col-span-3">
        <${Card} className="p-6 sm:p-8">

          <${Section} id="getting-started" title="Getting started">
            <${P}>Loonie Ledger is a private, local-only household finance tracker. It runs entirely
              in your browser — no account, no cloud sync, no bank-linking service. You feed it the
              CSV and PDF statements you already download from your bank, and it turns them into
              searchable transactions, categories, and reports.</${P}>
            <${Sub}>The three-step flow</${Sub}>
            <${UL}>
              <li><strong>Download your statement</strong> from your bank — a CSV export or a PDF statement, the same way you always have.</li>
              <li><strong>Drop it into Upload.</strong> Loonie Ledger detects the format, finds a matching converter, and parses the transactions.</li>
              <li><strong>Review and explore.</strong> Confirm the parsed rows, then use Transactions and Reports across all your accounts.</li>
            </${UL}>
            <${P} className="mt-3">No sign-up, no subscription, no bank connections required.
              See <${Jump} onJump=${jump} id="privacy">Privacy & your data</${Jump}> for exactly where everything is stored.</${P}>
          </${Section}>

          <${Section} id="privacy" title="Privacy & your data">
            <${P}>Everything you import stays inside this browser. Your transactions are never sent
              to any server. There is exactly one optional exception, described in
              <${Jump} onJump=${jump} id="ai-converters">AI converter setup</${Jump}>.</${P}>
            <${Sub}>Where your data lives</${Sub}>
            <${P}>On startup the app picks the best available storage: <${C}>IndexedDB</${C}> first,
              then <${C}>localStorage</${C}>, then in-memory as a last resort. The whole database is
              one JSON blob. The current mode is shown in the footer at the bottom of every page.</${P}>
            <${Note}>If the footer says <strong>In-memory</strong>, your data will vanish when you
              close the tab. Use <strong>Settings → Export backup</strong> to save it to a file.</${Note}>
            <${Sub}>API keys</${Sub}>
            <${P}>If you connect an AI provider, your API key is stored only in this browser's local
              storage and is <strong>excluded from backup exports</strong>. It is never written into
              the database blob.</${P}>
          </${Section}>

          <${Section} id="uploads" title="Uploading statements">
            <${P}>Drag a file onto the drop zone in the Upload view, or click to browse. CSV, TSV,
              TXT, and PDF are accepted. A preview of the raw text appears so you can confirm you
              picked the right file.</${P}>
            <${Sub}>Choosing a converter</${Sub}>
            <${P}>Pick the <strong>institution</strong>, optionally an <strong>account type</strong>,
              and an <strong>account name</strong> (e.g. "TD Visa — Joint"). Loonie Ledger then shows
              the converters that match. Choose one and it parses the document into a review screen.
              If no converter matches, you can build one — see
              <${Jump} onJump=${jump} id="converters">Converters</${Jump}> and
              <${Jump} onJump=${jump} id="ai-converters">AI converter setup</${Jump}>.</${P}>
            <${Sub}>Filename reuse</${Sub}>
            <${P}>When you drop a file whose name matches a previous upload, Loonie Ledger offers to
              reuse the same converter and account in one click. Matching ignores dates and statement
              numbers, so <${C}>Visa Statement-6503 2025-01-09.pdf</${C}> and the February version are
              recognized as the same recurring statement.</${P}>
            <${Sub}>Batch upload</${Sub}>
            <${P}>Drop several files at once. Any file that matches a previous upload by filename is
              parsed automatically; clean ones (no warnings, no duplicates) are imported straight away,
              and anything needing attention is queued for review. Unrecognized files are listed so you
              can drop them individually to set up a converter.</${P}>
          </${Section}>

          <${Section} id="converters" title="Converters">
            <${P}>A <strong>converter</strong> is a small, reusable recipe that teaches Loonie Ledger
              how to read one institution's document format (for example "RBC Visa PDF" or "TD Chequing
              CSV"). Parsing is <strong>100% deterministic</strong> — the converter is just a set of
              rules; the same file always produces the same transactions.</${P}>
            <${Sub}>Built-in vs. custom</${Sub}>
            <${P}>Loonie Ledger ships with built-in converters for the banks Canadians actually use —
              <strong>TD, RBC, Amex, and BMO</strong> (chequing, credit card, and statement formats),
              plus a generic CSV fallback. Converters you create or import are marked
              <strong>Custom</strong>. Manage all of them in the <strong>Converters</strong> view, where
              you can view/edit the spec, see how many imports used it, and export or delete it.
              Deleting a converter never affects already-imported transactions.</${P}>
            <${Sub}>How a converter is described</${Sub}>
            <${P}>Each converter stores a JSON <em>spec</em>. CSV specs map columns to fields; PDF specs
              use a regular expression (or column x-coordinates) to pull fields out of each line.</${P}>
            <${P} className="mt-2">A simple CSV spec:</${P}>
            <${Pre}>${`{
  "type": "csv",
  "has_header": true,
  "delimiter": ",",
  "columns": { "transaction_date": "Date",
               "description": "Description",
               "amount": "Amount" },
  "date_format": "MM/DD/YYYY",
  "amount_handling": "single_signed",
  "amount_sign": "natural"
}`}</${Pre}>
            <${P} className="mt-3">A line-based PDF spec:</${P}>
            <${Pre}>${`{
  "type": "pdf",
  "line_regex": "^(\\\\w{3} \\\\d{1,2})\\\\s+(.+?)\\\\s+(-?\\\\$[\\\\d,.]+)$",
  "groups": { "transaction_date": 1, "description": 2, "amount": 3 },
  "date_format": "MMM DD",
  "amount_sign": "flipped"
}`}</${Pre}>
            <${P} className="mt-3"><strong>Sign convention:</strong> after parsing, a negative amount
              means money out (an expense) and a positive amount means money in. Credit-card statements
              that print charges as positive use <${C}>amount_sign: "flipped"</${C}> to normalize them.</${P}>
            <${Sub}>Sharing converters</${Sub}>
            <${P}>Export a converter to a small JSON file from the Converters view and share it; the
              recipient imports it with <strong>Import converter</strong>. The shared file contains only
              the parsing rules — no transactions and no account nickname.</${P}>
          </${Section}>

          <${Section} id="ai-converters" title="AI converter setup">
            <${P}>This is the feature that lets Loonie Ledger handle <em>any</em> bank, not just the
              built-in ones. When no converter exists for your statement, choose
              <strong>✨ Set up with AI</strong> and an assistant will author a converter for you by
              looking at the structure of your document — then hand you a normal, deterministic
              converter that's reused automatically from then on.</${P}>

            <${Sub}>What the AI sees (and what it doesn't)</${Sub}>
            <${P}>The model's <strong>only</strong> job is to write the parser spec. It receives a short
              excerpt of your statement so it can learn the <em>layout</em> — column positions, date
              formats, where the amount sits. It never receives your imported transactions, and once the
              spec is saved, all parsing happens locally with no further AI involvement.</${P}>
            <${Note}><strong>Consider removing personal information first.</strong> The wizard sends a
              portion of your document to the AI provider. Consider redacting your name and address, full
              account numbers (last 4 digits are fine), and exact balances. 5–10 representative rows are
              plenty — dates, merchant names, and amounts can stay, since they help the AI understand the
              format.</${Note}>

            <${Sub}>Bring your own key</${Sub}>
            <${P}>You supply an API key from <strong>Anthropic (Claude)</strong> or
              <strong>OpenAI (GPT)</strong>. The key is stored only in this browser's local storage, sent
              directly to that provider, and excluded from backup exports.</${P}>
            <${Note}>Because this page loads libraries from public CDNs, treat the key as exposed to the
              page — use a key you can rotate, and never share it. You can manage or clear it any time in
              <strong>Settings → AI assistant</strong>.</${Note}>

            <${Sub}>How the wizard works</${Sub}>
            <${UL}>
              <li>It extracts an excerpt of your document. For PDFs it also samples the x-coordinates of
                each item, so even true table layouts (debit vs. credit by column) can be solved.</li>
              <li>The AI proposes a spec. The wizard <strong>runs it locally and feeds any parse errors
                back to the model automatically</strong>, up to two silent retries, before handing control
                to you.</li>
              <li>You refine in plain language ("the dates are off by a month", "amounts should be
                flipped") while watching a <strong>live preview</strong> of the first parsed transactions
                and a parsed/warnings count.</li>
              <li>Save once the preview looks right — you only need at least one parsed transaction, since
                a valid converter can still emit harmless warnings.</li>
            </${UL}>
            <${P} className="mt-3">The saved converter is indistinguishable from a hand-written one and is
              matched to future uploads just like a built-in.</${P}>
            <${P} className="mt-3"><strong>No API key?</strong> You can still build a converter by hand
              with <strong>Bootstrap manually</strong>, which proposes a spec from heuristics and lets you
              adjust the column/regex mapping with a live preview.</${P}>
          </${Section}>

          <${Section} id="review" title="Reviewing before import">
            <${P}>Parsing a document opens the <strong>Review</strong> screen so nothing is imported
              blindly. Each row can be edited inline — date, description, merchant, category, and type —
              excluded, or deleted before you commit.</${P}>
            <${Sub}>Duplicates</${Sub}>
            <${P}>Every transaction gets a fingerprint from its date, amount, type, description, and
              account. Rows that match something already imported are flagged as
              <strong>duplicates</strong> and unchecked automatically, so re-importing the same statement
              twice never creates doubles.</${P}>
            <${Sub}>Filters & warnings</${Sub}>
            <${P}>Filter the list to <em>Duplicates</em>, <em>Excluded</em>, or <em>Issues only</em>. If
              the converter produced any non-fatal warnings (for example a statement total that didn't add
              up to the penny), they appear in an expandable <strong>parse warnings</strong> panel. When
              reviewing a batch, a progress banner shows which file you're on.</${P}>
          </${Section}>

          <${Section} id="transactions" title="Transactions">
            <${P}>The Transactions view is the searchable ledger across every account. Filter by date
              range, account, category, or free-text search; sort any column; and page through large sets.</${P}>
            <${UL}>
              <li><strong>Inline category</strong> — change a transaction's category right in the table.</li>
              <li><strong>Exclude</strong> — tick a row to keep it out of reports without deleting it.</li>
              <li><strong>+rule</strong> — turn a transaction into a reusable category rule (see
                <${Jump} onJump=${jump} id="categorization">Categories & rules</${Jump}>).</li>
              <li><strong>Source ⓘ</strong> — see which statement a transaction came from.</li>
              <li><strong>🔁</strong> marks charges detected as recurring.</li>
              <li><strong>Export CSV</strong> downloads the currently filtered rows.</li>
            </${UL}>
          </${Section}>

          <${Section} id="categorization" title="Categories & rules">
            <${P}>Each transaction has a <strong>type</strong> (expense, income, transfer, refund, or
              CC payment) inferred from its amount sign and account, and a <strong>category</strong>
              (Groceries, Dining, Subscriptions, …).</${P}>
            <${Sub}>Automatic categorization</${Sub}>
            <${P}>On import, descriptions are matched against a built-in library of Canadian merchant
              keywords (Loblaws → Groceries, Tim Hortons → Dining, Petro-Canada → Fuel, and so on).
              Anything unmatched lands in <em>Other</em>.</${P}>
            <${Sub}>Your own rules</${Sub}>
            <${P}>Create rules from the <strong>+rule</strong> button on any transaction. A rule has a
              <strong>pattern</strong>, a <strong>match type</strong> (<${C}>contains</${C}>,
              <${C}>startswith</${C}>, or <${C}>regex</${C}>), a target category, and a
              <strong>priority</strong> (higher runs first). You can apply a new rule to all existing
              transactions at once.</${P}>
            <${Sub}>AI Suggest</${Sub}>
            <${P}>When transactions are uncategorized, the <strong>AI Suggest</strong> button offers
              bulk suggestions. Two ways to run it:</${P}>
            <${UL}>
              <li><strong>With an Anthropic API key</strong> — it categorizes in batches automatically.</li>
              <li><strong>Clipboard, no key</strong> — copy the generated prompt, paste it into Claude.ai,
                and paste the JSON answer back.</li>
            </${UL}>
            <${P} className="mt-2">Either way you review every suggestion, uncheck any you don't want, and
              optionally save them as rules so future imports categorize themselves.</${P}>
          </${Section}>

          <${Section} id="reports" title="Reports">
            <${P}>Reports summarize spending over a date range you control with quick presets (this
              month, last month, 3/6 months, this/last year) or custom dates. You can scope to one
              account and choose whether to <strong>exclude transfers</strong> and
              <strong>CC payments</strong> so they don't distort spending totals.</${P}>
            <${UL}>
              <li><strong>Summary tiles</strong> — total expenses, total income, net, and average per month.</li>
              <li><strong>Monthly expenses</strong> — expenses vs. income per month.</li>
              <li><strong>By category</strong> — a breakdown of where the money went.</li>
              <li><strong>Top merchants</strong> — click a row to expand its individual transactions.</li>
              <li><strong>Month-over-month</strong> — percentage change vs. the previous month.</li>
              <li><strong>Recurring charges</strong> — see <${Jump} onJump=${jump} id="recurring">below</${Jump}>.</li>
            </${UL}>
            <${P} className="mt-2">Your report range and toggles are remembered between visits.</${P}>
          </${Section}>

          <${Section} id="recurring" title="Recurring charges">
            <${P}>Loonie Ledger flags likely subscriptions and other monthly debits automatically. A
              merchant is treated as recurring when it has:</${P}>
            <${UL}>
              <li>at least <strong>3 charges</strong> from the same merchant,</li>
              <li>spaced roughly <strong>25–35 days apart</strong>, and</li>
              <li>within about <strong>10% of the typical (median) amount</strong>.</li>
            </${UL}>
            <${P} className="mt-2">The Reports table lists each one with its typical amount, cadence, last
              seen date, and an estimated monthly total. Matching charges are marked with 🔁 in the
              Transactions view too.</${P}>
          </${Section}>

          <${Section} id="history" title="Upload history">
            <${P}>The History view is a log of every document you've uploaded — filename, institution,
              account, converter used, and status. Deleting a document here also removes the transactions
              that came from it (you're told how many before confirming), which is the clean way to undo a
              bad import.</${P}>
          </${Section}>

          <${Section} id="settings" title="Settings">
            <${UL}>
              <li><strong>Date format</strong> — ISO (<${C}>2025-05-31</${C}>) or friendly (<${C}>May 31st, 2025</${C}>).</li>
              <li><strong>AI assistant</strong> — choose your provider and save/clear the API key used by
                the converter wizard. The key never touches your transactions or backups.</li>
              <li><strong>Export backup</strong> — download all transactions, accounts, and converters as
                one JSON file.</li>
              <li><strong>Import backup</strong> — replace all data from a previously exported file.</li>
              <li><strong>Factory reset</strong> — delete everything and restore the built-in converters.</li>
            </${UL}>
          </${Section}>

          <${Section} id="faq" title="FAQ & troubleshooting">
            <${Sub}>My bank isn't built in.</${Sub}>
            <${P}>Drop a statement, then use <strong>✨ Set up with AI</strong> (or Bootstrap manually) to
              create a converter. After that, uploads from that bank work like any built-in.</${P}>
            <${Sub}>The dates on my PDF are wrong.</${Sub}>
            <${P}>PDF transaction lines often print only the month and day, so the converter recovers the
              year from the statement's period header. If that header doesn't match, the converter shows a
              warning in the review screen — adjust the converter (or ask the AI wizard to fix it).</${P}>
            <${Sub}>I see a "total didn't match" warning.</${Sub}>
            <${P}>Some converters cross-check the parsed sum against a printed statement total. A mismatch
              is a <strong>non-fatal</strong> heads-up to double-check a few rows; it doesn't block import.</${P}>
            <${Sub}>Will re-importing a statement duplicate everything?</${Sub}>
            <${P}>No. Duplicate detection (see <${Jump} onJump=${jump} id="review">Reviewing</${Jump}>)
              fingerprints each transaction and skips ones you already have.</${P}>
            <${Sub}>The footer says I'm working in memory.</${Sub}>
            <${P}>Your browser blocked persistent storage. Use <strong>Settings → Export backup</strong>
              before closing the tab so you don't lose your data.</${P}>
          </${Section}>

        </${Card}>
      </div>
    </div>
  </${PageContainer}>`;
}

// Inline text link that jumps to another help section.
function Jump({ id, onJump, children }) {
  return html`<button type="button" onClick=${() => onJump(id)} class="text-maple-deep hover:underline font-medium">${children}</button>`;
}
