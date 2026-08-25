import type { ReactNode } from 'react';

export type BadgeTone =
  | 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'purple';

const STATUS_TONE: Record<string, BadgeTone> = {
  present: 'success', approved: 'success', paid: 'success', active: 'success',
  pending: 'warn', draft: 'warn',
  rejected: 'danger', absent: 'danger', inactive: 'danger',
  paid_leave: 'info', processed: 'info', advance: 'info',
  weekly_off: 'purple', company_holiday: 'purple', expense: 'purple',
};

const STATUS_LABEL: Record<string, string> = {
  present: 'Present', paid_leave: 'Paid Leave', weekly_off: 'Weekly Off',
  company_holiday: 'Holiday', absent: 'Absent',
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
  draft: 'Draft', processed: 'Processed', paid: 'Paid',
  active: 'Active', inactive: 'Inactive',
};

export function Badge(
  { tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode },
) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Badge whose colour and label are derived from a known status string. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
