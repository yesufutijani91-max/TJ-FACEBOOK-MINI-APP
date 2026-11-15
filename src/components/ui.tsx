import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../shared/types';
import { initials } from '../lib/format';
import { useSession } from '../state/session';
import { Icon, type IconName } from './icons';

export function Avatar({
  user,
  size = 40,
  ring = false,
  className = '',
}: {
  user: Pick<User, 'name' | 'avatarUrl' | 'handle'> | null;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const dimension = { width: size, height: size };
  const base = `shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-brand-100 to-brand-300 text-brand-800 grid place-items-center font-semibold ${
    ring ? 'ring-2 ring-white dark:ring-[#0d1117]' : ''
  } ${className}`;
  if (!user) {
    return <span className={base} style={dimension} aria-hidden="true" />;
  }
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        className={`${base} object-cover`}
        style={dimension}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span className={base} style={{ ...dimension, fontSize: size * 0.36 }} aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  icon = 'sparkle',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card animate-fade flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
        <Icon name={icon} size={24} />
      </span>
      <div>
        <p className="font-semibold text-strong">{title}</p>
        {description && <p className="mt-1 text-sm text-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  active = false,
  className = '',
  ...rest
}: { icon: IconName; label: string; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${active ? 'text-brand-600' : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={20} filled={active} />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-rise relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-[var(--surface)] shadow-float sm:rounded-3xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-subtle px-5 py-3.5">
          <h2 className="text-base font-semibold text-strong">{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-subtle px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-soft">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-[var(--surface-muted)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            value === option.value
              ? 'bg-[var(--surface)] text-brand-700 shadow-sm dark:text-brand-300'
              : 'text-soft hover:text-strong'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      {description && <p className="text-sm text-soft">{description}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-soft" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner size={16} /> : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function ToastHost() {
  const { toasts } = useSession();
  if (!toasts.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-8">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`animate-rise pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium shadow-float ${
            toast.kind === 'error'
              ? 'bg-[#b42318] text-white'
              : toast.kind === 'success'
                ? 'bg-[#0f7b4f] text-white'
                : 'bg-ink text-white dark:bg-white dark:text-ink'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Click-to-play video that stays lightweight until requested. */
export function LazyVideo({ src, className = '' }: { src: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className={`relative grid w-full place-items-center bg-black/80 ${className}`}
        aria-label="Play video"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-ink shadow-float">
          <Icon name="play" size={22} filled />
        </span>
      </button>
    );
  }
  return (
    <video ref={ref} src={src} controls autoPlay playsInline className={`w-full ${className}`} />
  );
}

/** Small hook for async actions with pending + error state. */
export function useAsyncAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<unknown>,
  onError?: (message: string) => void,
) {
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      try {
        await action(...args);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Something went wrong';
        onError?.(message);
        return false;
      } finally {
        setPending(false);
      }
    },
    [action, onError],
  );
  return { pending, run };
}
