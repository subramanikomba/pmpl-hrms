import { useState } from 'react';
import { payrollApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { PayrollRecord } from '@/types/db';

/**
 * Proof-of-payment attachment on a payroll row.
 *
 * Access is enforced by RLS on the storage bucket: Admin always, the employee
 * only when this payment was explicitly shared. This component just reflects
 * that — hiding it in the UI is never the control.
 */
export function PaymentAttachment(
  { record, isAdmin, onChanged }: {
    record: PayrollRecord;
    isAdmin: boolean;
    onChanged?: () => void;
  },
) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const path = record.payment_attachment_url;

  if (!path) return null;
  // An employee sees it only when Admin shared this payment.
  if (!isAdmin && !record.payment_attachment_shared) return null;

  async function open() {
    if (!path) return;
    setBusy(true);
    try {
      const url = await payrollApi.attachmentUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the attachment');
    } finally { setBusy(false); }
  }

  async function toggleShared() {
    setBusy(true);
    try {
      await payrollApi.setAttachmentShared(
        record.id, !record.payment_attachment_shared);
      toast.success(record.payment_attachment_shared
        ? 'Attachment is now Admin-only.'
        : 'Attachment is now visible to the employee.');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change sharing');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!path) return;
    if (!window.confirm('Remove the payment attachment?')) return;
    setBusy(true);
    try {
      await payrollApi.removeAttachment(record.id, path);
      toast.info('Attachment removed.');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the attachment');
    } finally { setBusy(false); }
  }

  return (
    <div className="payment-block">
      <p>
        Payment proof{' '}
        {isAdmin && (
          <Badge tone={record.payment_attachment_shared ? 'info' : 'neutral-alt'}>
            {record.payment_attachment_shared
              ? 'Shared with employee' : 'Admin only'}
          </Badge>
        )}
      </p>
      <div className="row-end gap">
        <Button size="sm" variant="secondary" disabled={busy}
          onClick={() => void open()}>View attachment</Button>
        {isAdmin && (
          <>
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => void toggleShared()}>
              {record.payment_attachment_shared ? 'Make Admin-only' : 'Share with employee'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => void remove()}>Remove</Button>
          </>
        )}
      </div>
    </div>
  );
}
