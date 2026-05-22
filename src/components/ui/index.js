import html from '../../html.js';
import { useState, useEffect, Fragment } from '../../react.js';
import { classNames } from '../../utils.js';
import { dao } from '../../db/store.js';

export function Button({ children, variant='primary', size='md', className='', ...props }) {
  const variants = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-white border-transparent',
    secondary: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-700 border-transparent',
    danger: 'bg-red-600 hover:bg-red-700 text-white border-transparent',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return html`<button
    class=${classNames(
      'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
      variants[variant], sizes[size], className
    )}
    ...${props}
  >${children}</button>`;
}

export function Card({ children, className='' }) {
  return html`<div class=${classNames('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>${children}</div>`;
}

export function CardHeader({ title, subtitle, right }) {
  return html`<div class="flex items-start justify-between p-5 border-b border-slate-200">
    <div>
      <h2 class="text-base font-semibold text-slate-900">${title}</h2>
      ${subtitle && html`<p class="text-xs text-slate-500 mt-0.5">${subtitle}</p>`}
    </div>
    ${right}
  </div>`;
}

export function Input({ className='', ...props }) {
  return html`<input
    class=${classNames(
      'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none',
      className
    )}
    ...${props}
  />`;
}

export function Select({ className='', children, ...props }) {
  return html`<select
    class=${classNames(
      'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none',
      className
    )}
    ...${props}
  >${children}</select>`;
}

export function Label({ children, className='' }) {
  return html`<label class=${classNames('block text-xs font-medium text-slate-700 mb-1', className)}>${children}</label>`;
}

export function Badge({ children, color='slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
  };
  return html`<span class=${classNames('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', colors[color])}>${children}</span>`;
}

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-slate-800' };
  return html`<div class="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2">
    <div class=${classNames('px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium', colors[toast.kind] || colors.info)}>
      ${toast.message}
    </div>
  </div>`;
}

export function Modal({ open, onClose, title, children, size='md', footer }) {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return html`<div class="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/40">
    <div class=${classNames('bg-white rounded-xl shadow-xl w-full max-h-[90vh] flex flex-col', sizes[size])}>
      <div class="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 class="text-base font-semibold">${title}</h3>
        <button onClick=${onClose} class="text-slate-500 hover:text-slate-700 text-xl leading-none">×</button>
      </div>
      <div class="p-5 overflow-auto flex-1 scrollbar-thin">${children}</div>
      ${footer && html`<div class="p-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-xl">${footer}</div>`}
    </div>
  </div>`;
}

export function EmptyState({ icon='📭', title, description, action }) {
  return html`<div class="text-center py-16 px-6">
    <div class="text-5xl mb-3">${icon}</div>
    <h3 class="text-base font-semibold text-slate-900">${title}</h3>
    ${description && html`<p class="text-sm text-slate-500 mt-1 max-w-md mx-auto">${description}</p>`}
    ${action && html`<div class="mt-4">${action}</div>`}
  </div>`;
}

export function StatTile({ label, value, sublabel, color='slate' }) {
  const colors = { slate: 'text-slate-900', green: 'text-emerald-600', red: 'text-red-600', blue: 'text-brand-600' };
  return html`<div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
    <div class="text-xs font-medium text-slate-500 uppercase tracking-wide">${label}</div>
    <div class=${classNames('text-2xl font-semibold mt-1.5', colors[color])}>${value}</div>
    ${sublabel && html`<div class="text-xs text-slate-500 mt-1">${sublabel}</div>`}
  </div>`;
}

export function SourceInfoButton({ documentId }) {
  const [open, setOpen] = useState(false);
  if (!documentId) return html`<span class="text-slate-300 text-xs" title="No source document">—</span>`;
  const doc = open ? dao.getDocument(documentId) : null;
  return html`<${Fragment}>
    <button
      type="button"
      onClick=${() => setOpen(true)}
      title="Source statement"
      class="inline-flex items-center justify-center w-5 h-5 rounded-full text-slate-400 hover:text-brand-600 hover:bg-brand-50 text-xs leading-none"
    >ⓘ</button>
    <${Modal} open=${open} onClose=${() => setOpen(false)} title="Source statement" size="sm">
      ${doc ? html`<dl class="text-sm space-y-3">
        <div>
          <dt class="text-slate-500 text-xs uppercase tracking-wide">File</dt>
          <dd class="font-mono break-all mt-0.5">${doc.filename}</dd>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Uploaded</dt>
            <dd class="mt-0.5">${doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Format</dt>
            <dd class="mt-0.5 uppercase">${doc.format || '—'}</dd>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Institution</dt>
            <dd class="mt-0.5">${doc.institution || '—'}</dd>
          </div>
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Account</dt>
            <dd class="mt-0.5">${doc.account_name || '—'}</dd>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Converter</dt>
            <dd class="mt-0.5">${doc.converter_name || '—'}</dd>
          </div>
          <div>
            <dt class="text-slate-500 text-xs uppercase tracking-wide">Status</dt>
            <dd class="mt-0.5"><${Badge}>${doc.status}</${Badge}></dd>
          </div>
        </div>
      </dl>` : html`<div class="text-sm text-slate-500">Source statement not found — it may have been deleted.</div>`}
    </${Modal}>
  </${Fragment}>`;
}
