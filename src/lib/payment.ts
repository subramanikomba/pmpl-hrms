export type PaymentState = 'paid' | 'payable' | 'overdue' | 'not_processed';

/**
 * Payment state for one payroll month.
 *
 * The rule that matters: Paid means the payment was actually RECORDED, never
 * that payroll was calculated, finalised or a slip generated. A finalised but
 * unpaid slip is Payable until its due date passes, and Overdue afterwards.
 */
export function paymentStateFor(
  args: {
    status: string | null;
    paymentDate: string | null;
    dueDate: Date;
    today: Date;
  },
): PaymentState {
  const { status, paymentDate, dueDate, today } = args;
  if (status === 'paid' && paymentDate) return 'paid';
  if (status !== 'processed' && status !== 'paid') return 'not_processed';
  const endOfDue = new Date(
    dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), 23, 59, 59);
  return today > endOfDue ? 'overdue' : 'payable';
}
