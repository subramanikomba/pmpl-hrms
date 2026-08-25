import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { attendanceApi, leaveApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import type { ApprovalStatus, LeaveRequest, WithEmployee } from '@/types/db';

function dayCount(from: string, to: string): number {
  const f = new Date(from), t = new Date(to);
  return Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
}

export function LeaveApprovalPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery(
    () => leaveApi.listAll(filter === 'all' ? undefined : filter),
    [filter],
  );

  async function approve(l: WithEmployee<LeaveRequest>) {
    if (!employee) return;
    setBusyId(l.id);
    try {
      await leaveApi.decide(l.id, 'approved', employee.id);
      // Spec: approved leave becomes paid_leave attendance on working days.
      // Sundays are already paid weekly offs and are skipped.
      const cur = new Date(l.from_date);
      const end = new Date(l.to_date);
      while (cur <= end) {
        if (cur.getDay() !== 0) {
          await attendanceApi.setStatus(
            l.employee_id, isoDate(cur), 'paid_leave', employee.id,
          );
        }
        cur.setDate(cur.getDate() + 1);
      }
      toast.success('Leave approved and attendance updated.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve leave');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(l: WithEmployee<LeaveRequest>) {
    if (!employee) return;
    setBusyId(l.id);
    try {
      await leaveApi.decide(l.id, 'rejected', employee.id);
      toast.info('Leave rejected.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reject leave');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Leave approvals" subtitle="Review and decide leave requests" />

      <Card>
        <Select label="Filter by status" value={filter}
          onChange={(e) => setFilter(e.target.value as ApprovalStatus | 'all')}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </Select>
      </Card>

      {q.loading ? <Spinner label="Loading leave requests…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (q.data ?? []).length === 0
          ? <Card><p className="muted">No leave requests match this filter.</p></Card>
          : (q.data ?? []).map((l) => (
            <Card key={l.id}>
              <div className="approval-head">
                <div>
                  <strong>
                    {l.employees?.first_name} {l.employees?.last_name}
                  </strong>{' '}
                  <span className="muted">{l.employees?.employee_code}</span>
                </div>
                <StatusBadge status={l.status} />
              </div>
              <p className="approval-dates">
                {formatDate(l.from_date)} – {formatDate(l.to_date)}{' '}
                <span className="muted">
                  ({dayCount(l.from_date, l.to_date)} day
                  {dayCount(l.from_date, l.to_date) > 1 ? 's' : ''})
                </span>
              </p>
              {l.reason && <p className="muted">{l.reason}</p>}

              {l.status === 'pending' ? (
                <div className="row-end gap">
                  <Button variant="ghost" disabled={busyId === l.id}
                    onClick={() => void reject(l)}>Reject</Button>
                  <Button variant="success" disabled={busyId === l.id}
                    onClick={() => void approve(l)}>Approve</Button>
                </div>
              ) : (
                <p className="decision-note">
                  {l.status === 'approved' ? 'Approved' : 'Rejected'} on {formatDate(l.reviewed_at)}
                  {l.review_note ? ` — ${l.review_note}` : ''}
                </p>
              )}
            </Card>
          ))}
    </>
  );
}
