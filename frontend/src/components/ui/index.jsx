import { forwardRef, useEffect, useId, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { X, Loader2, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react';
import { dropToast } from '../../redux/store';
import { humanize } from '../../utils/format';

export const Spinner = ({ className = 'size-5' }) => <Loader2 className={`animate-spin text-aqua ${className}`} aria-hidden />;

export function Loading({ label = 'Loading' }) {
  return <div className="flex items-center gap-3 py-16 justify-center text-ink-soft" role="status"><Spinner /> {label}…</div>;
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-ctl)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{children}</div>
      {onRetry && <button className="font-semibold underline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Icon className="size-9 text-shoal" strokeWidth={1.5} />
      <p className="font-display text-lg text-depth">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export const Field = ({ label, error, hint, children, className = '' }) => {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}</label>}
      {child}
      {error ? <p className="mt-1 text-[13px] text-danger">{error}</p> : hint ? <p className="mt-1 text-[12.5px] text-ink-soft">{hint}</p> : null}
    </div>
  );
};

export const Input = forwardRef(({ label, error, hint, className = '', ...p }, ref) => (
  <Field label={label} error={error} hint={hint} className={className}>
    {(id) => <input id={id} ref={ref} className={`input ${error ? 'input-error' : ''}`} aria-invalid={!!error} {...p} />}
  </Field>
));

export const Select = forwardRef(({ label, error, hint, options = [], className = '', placeholder, ...p }, ref) => (
  <Field label={label} error={error} hint={hint} className={className}>
    {(id) => (
      <select id={id} ref={ref} className={`input ${error ? 'input-error' : ''}`} {...p}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{humanize(o)}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    )}
  </Field>
));

export const Textarea = forwardRef(({ label, error, hint, className = '', ...p }, ref) => (
  <Field label={label} error={error} hint={hint} className={className}>
    {(id) => <textarea id={id} ref={ref} rows={4} className={`input ${error ? 'input-error' : ''}`} {...p} />}
  </Field>
));

export const Checkbox = forwardRef(({ label, ...p }, ref) => (
  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
    <input type="checkbox" ref={ref} className="size-4 accent-[var(--color-aqua)]" {...p} /> {label}
  </label>
));

export function Button({ busy, children, variant = 'primary', size, className = '', ...p }) {
  return (
    <button className={`btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={busy || p.disabled} {...p}>
      {busy && <Loader2 className="size-4 animate-spin" />}{children}
    </button>
  );
}

const TONES = {
  neutral: 'bg-mist text-ink-soft', aqua: 'bg-[#dff3f8] text-aqua-700', ok: 'bg-ok-soft text-ok', warn: 'bg-marigold-soft text-[#9a6a12]', danger: 'bg-danger-soft text-danger', dark: 'bg-depth text-white',
};
const STATUS_TONE = {
  pending: 'warn', confirmed: 'aqua', processing: 'aqua', packed: 'aqua', ready_for_dispatch: 'aqua', dispatched: 'aqua', out_for_delivery: 'aqua', delivered: 'ok', cancelled: 'danger', return_requested: 'warn', returned: 'neutral',
  paid: 'ok', unpaid: 'warn', partially_paid: 'warn', pending_verification: 'warn', refunded: 'neutral', partially_refunded: 'neutral', failed: 'danger',
  captured: 'ok', created: 'neutral', rejected: 'danger', approved: 'ok', active: 'ok', paused: 'warn', suspended: 'danger', inactive: 'neutral', out_of_stock: 'danger',
  open: 'warn', in_progress: 'aqua', resolved: 'ok', closed: 'neutral', new: 'warn', contacted: 'aqua', verified: 'ok', assigned: 'aqua', picked_up: 'aqua', depleted: 'neutral', expired: 'danger', quarantined: 'warn', requested: 'warn', completed: 'ok', reassigned: 'neutral',
};
export const Badge = ({ tone = 'neutral', children, className = '' }) => <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || 'neutral'}>{humanize(status)}</Badge>;

export function Modal({ open, onClose, title, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector('input,select,textarea,button')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-depth/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full flex-col rounded-t-[var(--radius-panel)] bg-white shadow-2xl sm:rounded-[var(--radius-panel)] ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-shoal px-5 py-4">
          <h3 className="text-lg">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-shoal px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts);
  const dispatch = useDispatch();
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dispatch(dropToast(t.id)), t.tone === 'danger' ? 6000 : 3500));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dispatch]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.tone === 'danger' ? 'bg-danger' : 'bg-depth'}`}>
          {t.tone === 'danger' ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4 text-[#7fd6e8]" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-3 text-sm text-ink-soft">
      <span>{(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <div className="flex gap-1">
        <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
        <span className="px-2 py-1.5">Page {page} of {pages}</span>
        <button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></button>
      </div>
    </div>
  );
}

/** columns: [{ key, label, render?(row), className? }] */
export function DataTable({ columns, rows, onRowClick, empty = 'Nothing here yet', rowKey = 'id' }) {
  if (!rows?.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer' : ''}>
              {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({ title, children, back, sub }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link to={back} className="mb-1 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-aqua-700"><ChevronLeft className="size-4" />Back</Link>}
        <h1 className="text-2xl sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, note, tone }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[13px] text-ink-soft">{label}</p>
      <p className={`mt-0.5 font-display text-[26px] font-bold leading-tight ${tone === 'warn' ? 'text-[#9a6a12]' : tone === 'danger' ? 'text-danger' : 'text-depth'}`}>{value}</p>
      {note && <p className="text-[12.5px] text-ink-soft">{note}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-shoal" role="tablist">
      {tabs.map((t) => {
        const v = typeof t === 'string' ? t : t.value;
        const l = typeof t === 'string' ? humanize(t) : t.label;
        return (
          <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold ${value === v ? 'border-aqua text-depth' : 'border-transparent text-ink-soft hover:text-depth'}`}>{l}</button>
        );
      })}
    </div>
  );
}

export function QtyStepper({ value, onChange, min = 1, step = 1, label = 'Quantity' }) {
  return (
    <div className="inline-flex items-center rounded-[var(--radius-ctl)] border border-shoal bg-white">
      <button type="button" className="px-3 py-2 text-lg leading-none text-depth disabled:opacity-30" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label="Decrease">−</button>
      <input aria-label={label} className="w-14 border-x border-shoal py-2 text-center text-sm font-semibold focus:outline-none" inputMode="numeric" value={value}
        onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); onChange(Number.isNaN(n) ? min : Math.max(min, n)); }} />
      <button type="button" className="px-3 py-2 text-lg leading-none text-depth" onClick={() => onChange(value + step)} aria-label="Increase">+</button>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, confirmText = 'Are you sure?', ...p }) {
  return <Button {...p} onClick={() => window.confirm(confirmText) && onConfirm()}>{children}</Button>;
}
