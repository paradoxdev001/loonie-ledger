import html from '../../html.js';
import { useState, useEffect, Fragment } from '../../react.js';
import { classNames } from '../../utils.js';
import { dao } from '../../db/store.js';

export function Button({ children, variant='primary', size='md', className='', ...props }) {
  const variants = {
    primary:   'bg-forest text-paper hover:bg-maple-deep border-transparent',
    secondary: 'bg-paper-2 hover:bg-paper-3 text-ink border-rule',
    ghost:     'bg-transparent hover:bg-paper-3 text-ink-mute border-transparent',
    danger:    'bg-plum hover:bg-plum-deep text-paper border-transparent',
    success:   'bg-forest text-paper border-transparent',
    maple:     'bg-maple text-ink border-transparent',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  return html`<button
    class=${classNames(
      'inline-flex items-center justify-center gap-1.5 font-medium rounded-full border transition-all disabled:opacity-50 disabled:cursor-not-allowed',
      variants[variant] || variants.primary, sizes[size], className
    )}
    ...${props}
  >${children}</button>`;
}

export function Card({ children, className='' }) {
  return html`<div class=${classNames('bg-paper-2 rounded-xl border border-rule shadow-sm', className)}>${children}</div>`;
}

export function CardHeader({ title, subtitle, right }) {
  return html`<div class="flex items-start justify-between p-5 border-b border-rule">
    <div>
      <h2 class="text-base font-semibold text-ink">${title}</h2>
      ${subtitle && html`<p class="text-xs text-ink-mute mt-0.5">${subtitle}</p>`}
    </div>
    ${right}
  </div>`;
}

export function Input({ className='', ...props }) {
  return html`<input
    class=${classNames(
      'block w-full rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm placeholder:text-ink-mute focus:border-maple focus:ring-1 focus:ring-maple outline-none',
      className
    )}
    ...${props}
  />`;
}

export function Select({ className='', children, ...props }) {
  return html`<select
    class=${classNames(
      'block w-full rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm focus:border-maple focus:ring-1 focus:ring-maple outline-none',
      className
    )}
    ...${props}
  >${children}</select>`;
}

export function Label({ children, className='' }) {
  return html`<label class=${classNames('block text-xs font-medium text-ink-mute mb-1', className)}>${children}</label>`;
}

export function Badge({ children, color='slate' }) {
  const colors = {
    slate:  'bg-paper-3 text-ink-2',
    green:  'bg-paper-3 text-forest',
    red:    'bg-plum-soft text-plum-deep',
    blue:   'bg-paper-3 text-sky',
    amber:  'bg-butter text-ink',
    violet: 'bg-paper-3 text-maple-deep',
  };
  return html`<span class=${classNames('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', colors[color] || colors.slate)}>${children}</span>`;
}

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  const colors = { success: 'bg-forest', error: 'bg-plum', info: 'bg-ink' };
  return html`<div class="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2">
    <div class=${classNames('px-4 py-3 rounded-full shadow-lg text-paper text-sm font-medium border border-rule', colors[toast.kind] || colors.info)}>
      ${toast.message}
    </div>
  </div>`;
}

export function Modal({ open, onClose, title, children, size='md', footer }) {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return html`<div class="fixed inset-0 z-40 flex items-center justify-center p-4" style=${{ background: 'rgba(22,24,31,0.45)' }}>
    <div class=${classNames('bg-paper-2 rounded-xl shadow-xl w-full max-h-[90vh] flex flex-col border border-rule', sizes[size])}>
      <div class="flex items-center justify-between p-4 border-b border-rule">
        <h3 class="text-base font-semibold text-ink">${title}</h3>
        <button onClick=${onClose} class="text-ink-mute hover:text-ink text-xl leading-none">×</button>
      </div>
      <div class="p-5 overflow-auto flex-1 scrollbar-thin">${children}</div>
      ${footer && html`<div class="p-4 border-t border-rule flex justify-end gap-2 bg-paper-3 rounded-b-xl">${footer}</div>`}
    </div>
  </div>`;
}

export function EmptyState({ icon='📭', title, description, action }) {
  return html`<div class="text-center py-16 px-6">
    <div class="text-5xl mb-3">${icon}</div>
    <h3 class="text-base font-semibold text-ink">${title}</h3>
    ${description && html`<p class="text-sm text-ink-mute mt-1 max-w-md mx-auto">${description}</p>`}
    ${action && html`<div class="mt-4">${action}</div>`}
  </div>`;
}

export function StatTile({ label, value, sublabel, color='slate' }) {
  const colors = { slate: 'text-ink', green: 'text-forest', red: 'text-plum', blue: 'text-maple-deep' };
  return html`<div class="bg-paper-2 rounded-xl border border-rule p-5 shadow-sm">
    <div class="text-xs font-mono font-medium text-ink-mute uppercase tracking-widest">${label}</div>
    <div class=${classNames('font-serif font-normal text-3xl mt-1.5 leading-tight', colors[color])} style=${{ letterSpacing: '-0.02em' }}>${value}</div>
    ${sublabel && html`<div class="text-xs text-ink-mute mt-1">${sublabel}</div>`}
  </div>`;
}

export function SourceInfoButton({ documentId }) {
  const [open, setOpen] = useState(false);
  if (!documentId) return html`<span class="text-ink-mute text-xs" title="No source document">—</span>`;
  const doc = open ? dao.getDocument(documentId) : null;
  return html`<${Fragment}>
    <button
      type="button"
      onClick=${() => setOpen(true)}
      title="Source statement"
      class="inline-flex items-center justify-center w-5 h-5 rounded-full text-ink-mute hover:text-maple hover:bg-paper-3 text-xs leading-none"
    >ⓘ</button>
    <${Modal} open=${open} onClose=${() => setOpen(false)} title="Source statement" size="sm">
      ${doc ? html`<dl class="text-sm space-y-3">
        <div>
          <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">File</dt>
          <dd class="font-mono break-all mt-0.5">${doc.filename}</dd>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Uploaded</dt>
            <dd class="mt-0.5">${doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Format</dt>
            <dd class="mt-0.5 uppercase">${doc.format || '—'}</dd>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Institution</dt>
            <dd class="mt-0.5">${doc.institution || '—'}</dd>
          </div>
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Account</dt>
            <dd class="mt-0.5">${doc.account_name || '—'}</dd>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Converter</dt>
            <dd class="mt-0.5">${doc.converter_name || '—'}</dd>
          </div>
          <div>
            <dt class="text-ink-mute text-xs uppercase tracking-wide font-mono">Status</dt>
            <dd class="mt-0.5"><${Badge}>${doc.status}</${Badge}></dd>
          </div>
        </div>
      </dl>` : html`<div class="text-sm text-ink-mute">Source statement not found — it may have been deleted.</div>`}
    </${Modal}>
  </${Fragment}>`;
}
