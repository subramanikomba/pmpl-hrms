import { useRef, useState } from 'react';
import { expenseApi, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

function prettySize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Optional receipt picker. The file is held in component state and only
 * uploaded when the expense is submitted.
 */
export function ReceiptPicker(
  { file, onChange }: { file: File | null; onChange: (f: File | null) => void },
) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(selected: File | null) {
    setError(null);
    if (!selected) { onChange(null); return; }

    if (!(RECEIPT_TYPES as readonly string[]).includes(selected.type)) {
      const msg = 'Receipt must be a PDF, JPG or PNG file.';
      setError(msg); toast.error(msg);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (selected.size > RECEIPT_MAX_BYTES) {
      const msg = `Receipt must be under ${prettySize(RECEIPT_MAX_BYTES)} (this file is ${prettySize(selected.size)}).`;
      setError(msg); toast.error(msg);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onChange(selected);
  }

  function clear() {
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor="receipt-input">
        Receipt / attachment (optional)
      </label>

      {file ? (
        <div className="receipt-chosen">
          <span className="receipt-name" title={file.name}>{file.name}</span>
          <span className="muted small">{prettySize(file.size)}</span>
          <Button size="sm" variant="ghost" type="button" onClick={clear}>Remove</Button>
        </div>
      ) : (
        <input
          id="receipt-input"
          ref={inputRef}
          className="input"
          type="file"
          accept={ACCEPT}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      )}

      <p className="field-hint">
        {error ?? 'PDF, JPG or PNG, up to 5 MB. Uploaded when you submit the expense.'}
      </p>
    </div>
  );
}

/**
 * Opens a receipt via a short-lived signed URL — the bucket is private, so
 * no permanent public link is ever stored or exposed.
 */
export function ReceiptLink({ path }: { path: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!path) return <span className="muted">No receipt attached</span>;

  async function open() {
    if (!path) return;
    setBusy(true);
    try {
      const url = await expenseApi.receiptUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open receipt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void open()}>
      {busy ? 'Opening…' : 'View receipt'}
    </Button>
  );
}
