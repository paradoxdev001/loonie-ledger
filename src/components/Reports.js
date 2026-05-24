import html from '../html.js';
import { useState, useEffect, useRef, useMemo } from '../react.js';
import { useApp } from '../state.js';
import { dao, STORE } from '../db/store.js';
import { formatMoney, classNames, monthKey, monthLabel, formatDateDisplay } from '../utils.js';
import { Card, CardHeader, StatTile } from './ui/index.js';
import { SourceInfoButton } from './ui/index.js';
import { PageContainer, PageHeader } from './Layout.js';

const Chart = window.Chart;

const REPORT_PREFS_KEY = 'report_prefs_v1';
function loadReportPrefs() {
  try { return JSON.parse(localStorage.getItem(REPORT_PREFS_KEY)) || null; } catch { return null; }
}
function saveReportPrefs(prefs) {
  try { localStorage.setItem(REPORT_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function detectRecurring(transactions) {
  const candidates = transactions.filter(t =>
    t.transaction_type === 'expense' && !t.is_excluded);

  const groups = {};
  candidates.forEach(t => {
    const key = ((t.merchant || t.description || '').slice(0, 40)).trim().toUpperCase();
    if (!key) return;
    (groups[key] = groups[key] || []).push(t);
  });

  const recurring = [];
  const recurringTxnIds = new Set();

  for (const [key, txns] of Object.entries(groups)) {
    if (txns.length < 3) continue;
    const sorted = txns.slice().sort((a, b) =>
      (a.transaction_date || '').localeCompare(b.transaction_date || ''));

    const amounts = sorted.map(t => Math.abs(t.amount));
    const sortedAmounts = amounts.slice().sort((a, b) => a - b);
    const median = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    const band = Math.max(2, median * 0.10);
    const tier = sorted.filter(t => Math.abs(Math.abs(t.amount) - median) <= band);
    if (tier.length < 3) continue;
    if (tier.length / sorted.length < 0.7) continue;

    const gaps = [];
    for (let i = 1; i < tier.length; i++) {
      const d1 = new Date(tier[i-1].transaction_date);
      const d2 = new Date(tier[i].transaction_date);
      const days = Math.round((d2 - d1) / 86400000);
      if (Number.isFinite(days) && days > 0) gaps.push(days);
    }
    if (gaps.length === 0) continue;
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    if (medianGap < 25 || medianGap > 35) continue;
    const monthlyGaps = gaps.filter(g => g >= 25 && g <= 35).length;
    if (monthlyGaps / gaps.length < 0.7) continue;

    recurring.push({
      key,
      name: tier[0].merchant || (tier[0].description || '').slice(0, 40),
      typical_amount: median,
      cadence_days: medianGap,
      last_seen: tier[tier.length - 1].transaction_date,
      occurrences: tier.length,
      monthly_estimate: median,
    });
    tier.forEach(t => recurringTxnIds.add(t.id));
  }

  recurring.sort((a, b) => b.monthly_estimate - a.monthly_estimate);
  return { recurring, recurringTxnIds };
}

export function ReportsView() {
  const { state } = useApp();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const thisYearFrom = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);

  const _prefs = loadReportPrefs();
  const [from, setFrom] = useState(_prefs?.from ?? thisYearFrom);
  const [to, setTo] = useState(_prefs?.to ?? todayStr);
  const [excludeTransfers, setExcludeTransfers] = useState(_prefs?.excludeTransfers ?? true);
  const [excludePayments, setExcludePayments] = useState(_prefs?.excludePayments ?? true);
  const [accounts, setAccounts] = useState([]);
  const [accountFilter, setAccountFilter] = useState(_prefs?.accountFilter ?? '');

  useEffect(() => {
    const activeIds = new Set(STORE.transactions.map(t => t.account_id));
    setAccounts(dao.listAccounts().filter(a => activeIds.has(a.id)));
  }, []);
  useEffect(() => {
    saveReportPrefs({ from, to, excludeTransfers, excludePayments, accountFilter });
  }, [from, to, excludeTransfers, excludePayments, accountFilter]);

  const txns = useMemo(() => {
    const all = dao.listTransactions({ from, to, account_id: accountFilter || null });
    return all.filter(t => !t.is_excluded
      && (!excludeTransfers || t.transaction_type !== 'transfer')
      && (!excludePayments || t.transaction_type !== 'cc_payment'));
  }, [from, to, excludeTransfers, excludePayments, accountFilter, state.refreshKey]);

  const isSpend = t => t.transaction_type === 'expense'
    || (t.signed_amount < 0 && (t.transaction_type === 'transfer' || t.transaction_type === 'cc_payment'));
  const isInflow = t => t.transaction_type === 'income'
    || (t.signed_amount > 0 && (t.transaction_type === 'transfer' || t.transaction_type === 'cc_payment'));
  const expenses = txns.filter(isSpend);
  const income = txns.filter(isInflow);

  const totalExpense = expenses.reduce((a, t) => a + t.amount, 0);
  const totalIncome = income.reduce((a, t) => a + t.amount, 0);

  return html`<${PageContainer}>
    <${PageHeader}
      title="Reports"
      description="Monthly spend, category breakdown, top merchants, and month-over-month deltas."
    />

    <${ReportControls}
      from=${from} setFrom=${setFrom}
      to=${to} setTo=${setTo}
      excludeTransfers=${excludeTransfers} setExcludeTransfers=${setExcludeTransfers}
      excludePayments=${excludePayments} setExcludePayments=${setExcludePayments}
      accounts=${accounts}
      accountFilter=${accountFilter} setAccountFilter=${setAccountFilter}
    />

    <${SummaryStrip}
      totalExpense=${totalExpense}
      totalIncome=${totalIncome}
      net=${totalIncome - totalExpense}
      count=${txns.length}
      from=${from}
      to=${to}
    />

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <div class="lg:col-span-2">
        <${Card}>
          <${CardHeader} title="Monthly expenses" subtitle="Total expense per month over the selected range" />
          <div class="p-5"><${MonthlyExpensesChart} expenses=${expenses} income=${income} /></div>
        </${Card}>
      </div>
      <${Card}>
        <${CardHeader} title="By category" subtitle="Total expense per category" />
        <div class="p-5"><${CategoryBreakdownChart} expenses=${expenses} /></div>
      </${Card}>
    </div>

    <div class="mt-6">
      <${Card}>
        <${CardHeader} title="Recurring charges" subtitle="Likely subscriptions and other monthly debits" />
        <${RecurringChargesTable} expenses=${expenses} />
      </${Card}>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <${Card}>
        <${CardHeader} title="Top merchants" subtitle="Where the money went — click a row to expand" />
        <${TopMerchantsTable} expenses=${expenses} />
      </${Card}>
      <${Card}>
        <${CardHeader} title="Month-over-month" subtitle="Percentage change vs. previous month" />
        <${MonthOverMonthTable} expenses=${expenses} />
      </${Card}>
    </div>
  </${PageContainer}>`;
}

function ReportControls({ from, setFrom, to, setTo, excludeTransfers, setExcludeTransfers, excludePayments, setExcludePayments, accounts, accountFilter, setAccountFilter }) {
  const presets = useMemo(() => {
    const today = new Date();
    const s = today.toISOString().slice(0, 10);
    const y = today.getFullYear();
    const m = today.getMonth();
    return {
      months: [
        { label: 'This month',  from: new Date(y, m, 1).toISOString().slice(0, 10),     to: s },
        { label: 'Last month',  from: new Date(y, m - 1, 1).toISOString().slice(0, 10), to: new Date(y, m, 0).toISOString().slice(0, 10) },
        { label: '3 months',    from: new Date(y, m - 2, 1).toISOString().slice(0, 10), to: s },
        { label: '6 months',    from: new Date(y, m - 5, 1).toISOString().slice(0, 10), to: s },
      ],
      years: [
        { label: 'This year',   from: new Date(y, 0, 1).toISOString().slice(0, 10),      to: s },
        { label: 'Last year',   from: new Date(y - 1, 0, 1).toISOString().slice(0, 10),  to: new Date(y - 1, 11, 31).toISOString().slice(0, 10) },
      ],
    };
  }, []);

  const allPresets = [...presets.months, ...presets.years];
  const activeLabel = allPresets.find(p => p.from === from && p.to === to)?.label;

  const PresetPill = ({ preset }) => html`<button
    onClick=${() => { setFrom(preset.from); setTo(preset.to); }}
    class=${`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap focus:outline-none ${
      activeLabel === preset.label
        ? 'bg-maple text-ink shadow-sm'
        : 'bg-paper-3 text-ink-2 hover:bg-paper-3 hover:text-ink'
    }`}
  >${preset.label}</button>`;

  return html`<${Card} className="mb-6">
    <div class="px-4 pt-3 pb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-soft">
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-xs font-semibold text-ink-mute uppercase tracking-wide mr-0.5">Months</span>
        ${presets.months.map(p => html`<${PresetPill} key=${p.label} preset=${p} />`)}
      </div>
      <div class="w-px h-5 bg-paper-3 hidden sm:block self-center" />
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-xs font-semibold text-ink-mute uppercase tracking-wide mr-0.5">Years</span>
        ${presets.years.map(p => html`<${PresetPill} key=${p.label} preset=${p} />`)}
      </div>
    </div>
    <div class="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
      <div>
        <label class="block text-xs font-medium text-ink-2 mb-1">From</label>
        <input type="date" value=${from} onChange=${e => setFrom(e.target.value)}
          class="block w-full rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm focus:border-maple focus:ring-1 focus:ring-maple outline-none" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-2 mb-1">To</label>
        <input type="date" value=${to} onChange=${e => setTo(e.target.value)}
          class="block w-full rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm focus:border-maple focus:ring-1 focus:ring-maple outline-none" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-2 mb-1">Account</label>
        <select value=${accountFilter} onChange=${e => setAccountFilter(e.target.value)}
          class="block w-full rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm focus:border-maple focus:ring-1 focus:ring-maple outline-none">
          <option value="">All accounts</option>
          ${accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.institution} · ${a.account_name}</option>`)}
        </select>
      </div>
      <div class="md:col-span-2 flex items-center gap-4 pb-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked=${excludeTransfers} onChange=${e => setExcludeTransfers(e.target.checked)} class="rounded border-rule" />
          Exclude transfers
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked=${excludePayments} onChange=${e => setExcludePayments(e.target.checked)} class="rounded border-rule" />
          Exclude CC payments
        </label>
      </div>
    </div>
  </${Card}>`;
}

function SummaryStrip({ totalExpense, totalIncome, net, count, from, to }) {
  const months = useMemo(() => {
    if (!from || !to) return 1;
    const a = new Date(from), b = new Date(to);
    const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
    return Math.max(1, m);
  }, [from, to]);
  return html`<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <${StatTile} label="Total expenses" value=${formatMoney(totalExpense)} color="red" sublabel=${`${count} transactions`} />
    <${StatTile} label="Total income" value=${formatMoney(totalIncome)} color="green" />
    <${StatTile} label="Net" value=${formatMoney(net)} color=${net >= 0 ? 'green' : 'red'} />
    <${StatTile} label="Avg / month" value=${formatMoney(totalExpense / months)} sublabel=${`across ${months} ${months === 1 ? 'month' : 'months'}`} />
  </div>`;
}

function useChart(canvasRef, factory, deps) {
  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = factory(canvasRef.current);
    return () => chart && chart.destroy();
  }, deps);
}

function MonthlyExpensesChart({ expenses, income }) {
  const ref = useRef(null);
  useChart(ref, (el) => {
    const months = {};
    expenses.forEach(t => {
      const k = monthKey(t.transaction_date);
      if (!months[k]) months[k] = { exp: 0, inc: 0 };
      months[k].exp += t.amount;
    });
    income.forEach(t => {
      const k = monthKey(t.transaction_date);
      if (!months[k]) months[k] = { exp: 0, inc: 0 };
      months[k].inc += t.amount;
    });
    const keys = Object.keys(months).sort();
    return new Chart(el, {
      type: 'bar',
      data: {
        labels: keys.map(monthLabel),
        datasets: [
          { label: 'Expenses', data: keys.map(k => months[k].exp), backgroundColor: '#ef4444' },
          { label: 'Income', data: keys.map(k => months[k].inc), backgroundColor: '#10b981' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v } } }
      }
    });
  }, [expenses, income]);
  return html`<div class="relative h-72"><canvas ref=${ref} /></div>`;
}

function CategoryBreakdownChart({ expenses }) {
  const ref = useRef(null);
  const data = useMemo(() => {
    const m = {};
    expenses.forEach(t => {
      const c = t.category || 'Other';
      m[c] = (m[c] || 0) + t.amount;
    });
    return m;
  }, [expenses]);

  useChart(ref, (el) => {
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return new Chart(el, {
      type: 'doughnut',
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{
          data: sorted.map(([, v]) => v),
          backgroundColor: ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16']
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });
  }, [data]);
  if (Object.keys(data).length === 0) return html`<div class="text-sm text-ink-mute py-10 text-center">No expenses in range.</div>`;
  return html`<div class="relative h-72"><canvas ref=${ref} /></div>`;
}

function TopMerchantsTable({ expenses }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const rows = useMemo(() => {
    const m = {};
    expenses.forEach(t => {
      const key = t.merchant || t.description.slice(0, 40);
      if (!m[key]) m[key] = { count: 0, total: 0, txns: [] };
      m[key].count++;
      m[key].total += t.amount;
      m[key].txns.push(t);
    });
    return Object.entries(m)
      .map(([k, v]) => ({ name: k, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [expenses]);

  const toggle = name => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return html`<div class="overflow-auto">
    <table class="w-full text-sm">
      <thead class="bg-paper text-ink-2 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">Merchant</th>
          <th class="text-right px-4 py-2">Visits</th>
          <th class="text-right px-4 py-2">Total</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-rule">
        ${rows.map(r => {
          const isOpen = expanded.has(r.name);
          const sortedTxns = r.txns.slice().sort((a, b) =>
            (b.transaction_date || '').localeCompare(a.transaction_date || ''));
          return html`<${window.React.Fragment} key=${r.name}>
            <tr
              class="hover:bg-paper cursor-pointer"
              onClick=${() => toggle(r.name)}
            >
              <td class="px-4 py-2 max-w-[280px]">
                <div class="flex items-center gap-2">
                  <span class="text-ink-mute text-xs w-3 inline-block">${isOpen ? '▾' : '▸'}</span>
                  <span class="truncate">${r.name}</span>
                </div>
              </td>
              <td class="px-4 py-2 text-right font-mono">${r.count}</td>
              <td class="px-4 py-2 text-right font-mono text-plum">${formatMoney(r.total)}</td>
            </tr>
            ${isOpen && html`<tr class="bg-paper">
              <td colspan="3" class="px-4 py-3">
                <table class="w-full text-xs">
                  <thead class="text-ink-mute uppercase tracking-wide">
                    <tr>
                      <th class="text-left px-2 py-1 font-medium">Date</th>
                      <th class="text-left px-2 py-1 font-medium">Description</th>
                      <th class="text-left px-2 py-1 font-medium">Account</th>
                      <th class="text-right px-2 py-1 font-medium">Amount</th>
                      <th class="text-center px-2 py-1 font-medium w-10">Source</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-rule">
                    ${sortedTxns.map(t => html`<tr key=${t.id}>
                      <td class="px-2 py-1 font-mono whitespace-nowrap text-ink-2">${formatDateDisplay(t.transaction_date)}</td>
                      <td class="px-2 py-1 max-w-[280px] truncate text-ink-2" title=${t.description}>${t.description}</td>
                      <td class="px-2 py-1 text-ink-mute">${t.institution || ''}${t.account_name ? ` · ${t.account_name}` : ''}</td>
                      <td class="px-2 py-1 text-right font-mono text-plum">${formatMoney(Math.abs(t.amount))}</td>
                      <td class="px-2 py-1 text-center">
                        <${SourceInfoButton} documentId=${t.document_id} />
                      </td>
                    </tr>`)}
                  </tbody>
                </table>
              </td>
            </tr>`}
          </${window.React.Fragment}>`;
        })}
      </tbody>
    </table>
    ${rows.length === 0 && html`<div class="py-6 text-center text-sm text-ink-mute">No expenses.</div>`}
  </div>`;
}

function RecurringChargesTable({ expenses }) {
  const { recurring } = useMemo(() => detectRecurring(expenses), [expenses]);
  const monthlyTotal = recurring.reduce((sum, r) => sum + r.monthly_estimate, 0);

  if (recurring.length === 0) {
    return html`<div class="py-8 text-center text-sm text-ink-mute">
      No recurring charges detected. Needs ≥3 similar charges from the same merchant, ~25–35 days apart.
    </div>`;
  }

  return html`<div class="overflow-auto">
    <table class="w-full text-sm">
      <thead class="bg-paper text-ink-2 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">Merchant</th>
          <th class="text-right px-4 py-2">Typical</th>
          <th class="text-right px-4 py-2">Cadence</th>
          <th class="text-left px-4 py-2">Last seen</th>
          <th class="text-right px-4 py-2">Occurrences</th>
          <th class="text-right px-4 py-2">Est. monthly</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-rule">
        ${recurring.map(r => html`<tr key=${r.key} class="hover:bg-paper">
          <td class="px-4 py-2 truncate max-w-[280px]">
            <div class="flex items-center gap-2">
              <span class="text-xs">🔁</span>
              <span class="truncate">${r.name}</span>
            </div>
          </td>
          <td class="px-4 py-2 text-right font-mono">${formatMoney(r.typical_amount)}</td>
          <td class="px-4 py-2 text-right font-mono text-ink-2">${r.cadence_days} d</td>
          <td class="px-4 py-2 font-mono text-xs text-ink-2">${r.last_seen}</td>
          <td class="px-4 py-2 text-right font-mono">${r.occurrences}</td>
          <td class="px-4 py-2 text-right font-mono text-plum">${formatMoney(r.monthly_estimate)}</td>
        </tr>`)}
      </tbody>
      <tfoot>
        <tr class="bg-paper border-t border-rule">
          <td colspan="5" class="px-4 py-2 text-right text-xs uppercase tracking-wide text-ink-2">Estimated monthly recurring spend</td>
          <td class="px-4 py-2 text-right font-mono font-semibold text-plum">${formatMoney(monthlyTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

function MonthOverMonthTable({ expenses }) {
  const rows = useMemo(() => {
    const months = {};
    expenses.forEach(t => {
      const k = monthKey(t.transaction_date);
      months[k] = (months[k] || 0) + t.amount;
    });
    const keys = Object.keys(months).sort();
    return keys.map((k, i) => {
      const prev = i > 0 ? months[keys[i-1]] : null;
      const delta = prev ? ((months[k] - prev) / prev) * 100 : null;
      return { month: k, total: months[k], delta };
    }).reverse();
  }, [expenses]);

  return html`<div class="overflow-auto">
    <table class="w-full text-sm">
      <thead class="bg-paper text-ink-2 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">Month</th>
          <th class="text-right px-4 py-2">Total</th>
          <th class="text-right px-4 py-2">vs. prev.</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-rule">
        ${rows.map(r => html`<tr key=${r.month}>
          <td class="px-4 py-2">${monthLabel(r.month)}</td>
          <td class="px-4 py-2 text-right font-mono">${formatMoney(r.total)}</td>
          <td class=${classNames('px-4 py-2 text-right font-mono text-xs', r.delta == null ? 'text-ink-mute' : r.delta > 0 ? 'text-plum' : 'text-forest')}>
            ${r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}%`}
          </td>
        </tr>`)}
      </tbody>
    </table>
    ${rows.length === 0 && html`<div class="py-6 text-center text-sm text-ink-mute">No data.</div>`}
  </div>`;
}
