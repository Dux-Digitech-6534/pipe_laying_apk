// Bottom sheet — the app's one modal primitive.
//
// Behaves like a native sheet: rises from the bottom, dims what's behind,
// dismisses on backdrop tap, on Back/Escape, and on a downward drag of the
// grip. Body scroll is locked while open so the page behind can't rubber-band.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconX } from '../icons';
import { tapLight } from '../haptics';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Search box or filter row pinned under the header. */
  toolbar?: ReactNode;
  showClose?: boolean;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  toolbar,
  showClose = true,
}: Props) {
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);

  // `onClose` is nearly always an inline arrow from the parent, so its identity
  // changes on every parent render. Held in a ref so the history effect below
  // can depend on `open` alone — depending on the callback made the effect tear
  // down and re-run on any parent re-render, and its cleanup's history.back()
  // then slammed the sheet shut while the user was still choosing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Play the exit animation before unmounting, so dismissal doesn't just blink.
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onCloseRef.current();
    }, 200);
  }, []);

  // Android's hardware Back arrives as a history pop inside a WebView. Push a
  // throwaway entry while open so Back closes the sheet instead of leaving the
  // screen — the single biggest "this doesn't feel native" tell.
  useEffect(() => {
    if (!open) return;

    const onPopState = () => requestClose();
    history.pushState({ plmSheet: true }, '');
    window.addEventListener('popstate', onPopState);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      // Closing by any route other than Back leaves our entry on the stack;
      // retire it so one Back press doesn't become a no-op.
      if (history.state?.plmSheet) history.back();
    };
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const onPointerDown = (event: React.PointerEvent) => {
    dragStart.current = event.clientY;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragStart.current === null || !sheetRef.current) return;
    const delta = event.clientY - dragStart.current;
    // Only track downward drags; upward does nothing (the sheet is already up).
    if (delta > 0) sheetRef.current.style.transform = `translateY(${delta}px)`;
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (dragStart.current === null || !sheetRef.current) return;
    const delta = event.clientY - dragStart.current;
    dragStart.current = null;

    sheetRef.current.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1)';
    if (delta > 90) {
      tapLight();
      requestClose();
    } else {
      sheetRef.current.style.transform = '';
    }
    window.setTimeout(() => {
      if (sheetRef.current) sheetRef.current.style.transition = '';
    }, 240);
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={requestClose} />
      <div
        className={`sheet${closing ? ' closing' : ''}`}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className="sheet-grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span />
        </div>

        <div className="sheet-head">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          {showClose ? (
            <button className="iconbtn plain" onClick={requestClose} aria-label="Close">
              <IconX />
            </button>
          ) : null}
        </div>

        {toolbar ? <div className="sheet-search">{toolbar}</div> : null}

        <div className="sheet-body">{children}</div>

        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </>
  );
}
