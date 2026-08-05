// Toasts, confirmation dialogs, and the small shared status widgets.
// Markup follows the prototype: `.tmsg` toasts, `.note` banners, `.sec-h`
// section headers.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { IconAlert, IconCheck, IconSparkle } from '../icons';
import { tapError, tapLight, tapSuccess } from '../haptics';

// -------------------------------------------------------------------- toast

type ToastKind = 'ok' | 'err' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  ok: (text: string) => void;
  err: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastApi>({
  ok: () => {},
  err: () => {},
  info: () => {},
});

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, kind, text }]);
    // Errors linger — a field user may be reading a validation message while
    // holding a tape measure.
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      kind === 'err' ? 6000 : 3200,
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      ok: (text) => {
        tapSuccess();
        push('ok', text);
      },
      err: (text) => {
        tapError();
        push('err', text);
      },
      info: (text) => push('info', text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length ? (
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`tmsg${toast.kind === 'err' ? ' err' : ''}`}>
              {toast.kind === 'ok' ? (
                <IconCheck />
              ) : toast.kind === 'err' ? (
                <IconAlert />
              ) : (
                <IconSparkle />
              )}
              <span>{toast.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

// ------------------------------------------------------------------ confirm

interface ConfirmProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
        <div className="btn-row">
          <button
            className="btn secondary"
            onClick={() => {
              tapLight();
              onCancel();
            }}
          >
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={() => {
              tapLight();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------------- bits

/** The prototype's note banner: tinted panel, leading glyph, small body copy. */
export function Note({
  kind = 'ok',
  icon,
  children,
  style,
}: {
  kind?: 'ok' | 'warn' | 'err' | 'info';
  icon?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`note${kind === 'ok' ? '' : ` ${kind}`}`} style={style}>
      {icon ?? <IconSparkle />}
      <div className="nt">{children}</div>
    </div>
  );
}

/** Section header: brand-coloured glyph, title, and an optional live figure. */
export function SectionHead({
  icon,
  title,
  value,
  unit,
}: {
  icon: ReactNode;
  title: string;
  value?: string;
  unit?: string;
}) {
  return (
    <div className="sec-h">
      {icon}
      <h3>{title}</h3>
      {value !== undefined ? (
        <span className="cnt">
          <b>{value}</b>
          {unit ? ` ${unit}` : ''}
        </span>
      ) : null}
    </div>
  );
}

export function StatusChip({
  docstatus,
  pending,
  t,
}: {
  docstatus: 0 | 1 | 2;
  pending?: boolean;
  t: (key: string) => string;
}) {
  if (pending) {
    return (
      <span className="status pending">
        <span className="dot" />
        {t('pending_sync')}
      </span>
    );
  }
  const kind = docstatus === 1 ? 'submitted' : docstatus === 2 ? 'cancelled' : 'draft';
  return (
    <span className={`status ${kind}`}>
      <span className="dot" />
      {t(kind)}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

export function Skeleton({ height = 72, count = 3 }: { height?: number; count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }, (_unused, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}
