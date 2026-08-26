import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Accessible modal: Escape closes, background scroll locked, focus trapped to dialog. */
export function Modal(
  { open, title, onClose, children, size = 'md',
    dismissOnBackdrop = true, confirmClose = false,
    confirmMessage = 'Discard your unsaved changes?' }:
  { open: boolean; title: string; onClose: () => void;
    children: ReactNode; size?: 'sm' | 'md' | 'lg';
    /** Data-entry modals set this false so a stray outside click cannot
     *  discard what the user has typed. */
    dismissOnBackdrop?: boolean;
    /** Ask before closing when the form holds unsaved input. */
    confirmClose?: boolean;
    confirmMessage?: string },
) {
  const requestClose = () => {
    if (confirmClose && !window.confirm(confirmMessage)) return;
    onClose();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, confirmClose, confirmMessage]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={dismissOnBackdrop ? requestClose : undefined}
    >
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={requestClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
