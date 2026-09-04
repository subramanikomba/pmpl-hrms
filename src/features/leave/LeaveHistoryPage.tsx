import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { leaveApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { LeaveRequest } from '@/types/db';

const columns: Column<LeaveRequest>[] = [
  { key: 'from', header: 'From', cell: (r) => formatDate(r.from_date) },
  { key: 'to', header: 'To', cell: (r) => formatDate(r.to_date) },
  { key: 'reason', header: 'Reason', cell: (r) => r.reason || '—' },
  { key: 'status', header: 'Status',
    cell: (r) => (
      <>
        <StatusBadge status={r.status} />
        {r.status === 'approved' && (
          <> <Badge tone={r.leave_type === 'paid_leave' ? 'info' : 'warn'}>
            {r.leave_type === 'paid_leave' ? 'Paid' : 'Unpaid'}
          </Badge></>
        )}
      </>
    ) },
  // Any reason the Admin gave with the decision, so a rejection is not silent.
  { key: 'note', header: "Admin's note",
    cell: (r) => r.review_note || <span className="muted">—</span> },
];

export function LeaveHistoryPage() {
  const { employee } = useAuth();
  const id = employee?.id ?? '';
  const q = useQuery(() => leaveApi.listFor(id), [id]);

  if (q.loading) return <Spinner label="Loading leave history…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;

  return (
    <>
      <PageHeader title="Leave history" subtitle="Your leave requests and their status" />
      <Card>
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          empty="You have not applied for any leave yet."
        />
      </Card>
    </>
  );
}
