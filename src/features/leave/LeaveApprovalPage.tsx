import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { attendanceApi, attendanceChangeApi, leaveApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Field';
import type {
  ApprovalStatus, AttendanceChangeRequest, LeaveRequest, WithEmployee,
} from '@/types/db';

/** Human labels for the previous attendance status shown on a request. */
const STATUS_WORD: Record<string, string> = {
  absent: 'Absent', present: 'Present', paid_leave: 'Paid Leave',
  weekly_off: 'Weekly Off', company_holiday: 'Holiday',
};

function dayCount(from: string, to: string): number {
  const f = new Date(from), t = new Date(to);
  return Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
}

export function LeaveApprovalPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<ApprovalStatus | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  // The request awaiting a paid/unpaid choice before approval.
  const [approving, setApproving] = useState<WithEmployee<LeaveRequest> | null>(null);
  // The request awaiting an optional rejection reason.
  const [rejecting, setRejecting] = useState<WithEmployee<LeaveRequest> | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const q = useQuery(
    () => leaveApi.listAll(filter === 'all' ? undefined : filter),
    [filter],
  );

  // Past-dated "change to Present" corrections are decided here too, so the
  // Admin has a single approvals screen rather than a second destination.
  const corrections = useQuery(
    () => attendanceChangeApi.listAll(filter === 'all' ? undefined : filter),
    [filter],
  );

  /**
   * Approving writes the attendance record and then records the decision.
   * Attendance is written first: if that fails the request stays pending and
   * can be retried, rather than being marked approved with no effect.
   */
  async function decideCorrection(
    r: WithEmployee<AttendanceChangeRequest>, approve: boolean,
  ) {
    if (!employee) return;
    setBusyId(r.id);
    try {
      if (approve) {
        await attendanceApi.setStatus(r.employee_id, r.date, 'present', employee.id);
      }
      await attendanceChangeApi.decide(
        r.id, approve ? 'approved' : 'rejected', employee.id,
      );
      toast.success(approve
        ? `Attendance for ${formatDate(r.date)} set to Present.`
        : 'Correction request rejected. Attendance is unchanged.');
      corrections.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not decide the request');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Approve a leave request as Paid or Unpaid. The choice drives the
   * attendance status written for each day, which is what payroll reads:
   * paid_leave counts towards paid days, unpaid_leave does not.
   */
  async function approve(
    l: WithEmployee<LeaveRequest>,
    leaveType: LeaveRequest['leave_type'],
  ) {
    if (!employee) return;
    setBusyId(l.id);
    try {
      await leaveApi.decide(l.id, 'approved', employee.id, undefined, leaveType);
      // Approved leave becomes leave attendance on working days.
      // Sundays are already paid weekly offs and are skipped.
      const cur = new Date(l.from_date);
      const end = new Date(l.to_date);
      while (cur <= end) {
        if (cur.getDay() !== 0) {
          await attendanceApi.setStatus(
            l.employee_id, isoDate(cur), leaveType, employee.id,
          );
        }
        cur.setDate(cur.getDate() + 1);
      }
      setApproving(null);
      toast.success(`Leave approved as ${
        leaveType === 'paid_leave' ? 'paid' : 'unpaid'} leave.`);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve leave');
    } finally {
      setBusyId(null);
    }
  }

  /** Reject, optionally recording a reason the employee will see. */
  async function reject(l: WithEmployee<LeaveRequest>, reason?: string) {
    if (!employee) return;
    setBusyId(l.id);
    try {
      await leaveApi.decide(
        l.id, 'rejected', employee.id, reason?.trim() || undefined);
      setRejecting(null);
      setRejectReason('');
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
      <PageHeader
        title="Approvals"
        subtitle="Leave requests and attendance corrections awaiting your decision"
      />

      <Card>
        <Select label="Filter by status" value={filter}
          onChange={(e) => setFilter(e.target.value as ApprovalStatus | 'all')}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </Select>
      </Card>

      {corrections.loading ? <Spinner label="Loading attendance corrections…" />
        : corrections.error
          ? <Card><p className="error-text">{corrections.error}</p></Card>
          : (corrections.data ?? []).length > 0 && (
            <Card title="Attendance correction requests">
              <p className="muted small">
                Employees requesting a past date be changed to Present.
                Approving updates the attendance record; rejecting leaves it as it is.
              </p>
              {(corrections.data ?? []).map((r) => (
                <div key={r.id} className="approval-row">
                  <div className="approval-head">
                    <div>
                      <strong>
                        {r.employees?.first_name} {r.employees?.last_name}
                      </strong>{' '}
                      <span className="muted">{r.employees?.employee_code}</span>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="approval-dates">
                    {formatDate(r.date)}{' '}
                    <span className="muted">
                      ({r.from_status ? STATUS_WORD[r.from_status] ?? r.from_status : 'Not marked'}
                      {' '}&rarr; Present)
                    </span>
                  </p>
                  {r.reason && <p className="muted">{r.reason}</p>}
                  {r.status === 'pending' ? (
                    <div className="row-end gap">
                      <Button variant="ghost" disabled={busyId === r.id}
                        onClick={() => void decideCorrection(r, false)}>Reject</Button>
                      <Button variant="success" disabled={busyId === r.id}
                        onClick={() => void decideCorrection(r, true)}>Approve</Button>
                    </div>
                  ) : (
                    <p className="decision-note">
                      {r.status === 'approved' ? 'Approved' : 'Rejected'} on{' '}
                      {formatDate(r.reviewed_at)}
                    </p>
                  )}
                </div>
              ))}
            </Card>
          )}

      {q.loading ? <Spinner label="Loading leave requests…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (
          <Card title="Leave requests">
            <p className="muted small">
              Employees requesting time off. Approving asks whether the leave is
              paid or unpaid, then writes that status to their attendance.
            </p>
            {(q.data ?? []).length === 0
              ? <p className="muted">No leave requests match this filter.</p>
              : (q.data ?? []).map((l) => (
                <div key={l.id} className="approval-row">
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
                    {l.status === 'approved' && (
                      <> <Badge tone={l.leave_type === 'paid_leave' ? 'info' : 'warn'}>
                        {l.leave_type === 'paid_leave' ? 'Paid' : 'Unpaid'}
                      </Badge></>
                    )}
                  </p>
                  {l.reason && <p className="muted">{l.reason}</p>}

                  {l.status === 'pending' ? (
                    <div className="row-end gap">
                      <Button variant="ghost" disabled={busyId === l.id}
                        onClick={() => { setRejectReason(''); setRejecting(l); }}>
                        Reject
                      </Button>
                      <Button variant="success" disabled={busyId === l.id}
                        onClick={() => setApproving(l)}>Approve</Button>
                    </div>
                  ) : (
                    <p className="decision-note">
                      {l.status === 'approved' ? 'Approved' : 'Rejected'} on {formatDate(l.reviewed_at)}
                      {l.review_note ? ` — ${l.review_note}` : ''}
                    </p>
                  )}
                </div>
              ))}
          </Card>
        )}

      {rejecting && (
        <Modal open size="sm" title="Reject leave request"
          onClose={() => setRejecting(null)} dismissOnBackdrop={false}>
          <p>
            <strong>
              {rejecting.employees?.first_name} {rejecting.employees?.last_name}
            </strong>{' '}
            — {formatDate(rejecting.from_date)} to {formatDate(rejecting.to_date)}
          </p>
          <TextArea label="Reason (optional)" rows={3} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            hint="Shown to the employee with the decision. Leave blank to reject without a reason." />
          <div className="row-end gap">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={busyId === rejecting.id}
              onClick={() => void reject(rejecting, rejectReason)}>
              Reject leave
            </Button>
          </div>
        </Modal>
      )}

      {approving && (
        <Modal open size="sm" title="Approve leave"
          onClose={() => setApproving(null)} dismissOnBackdrop={false}>
          <p>
            <strong>
              {approving.employees?.first_name} {approving.employees?.last_name}
            </strong>{' '}
            — {formatDate(approving.from_date)} to {formatDate(approving.to_date)}
            {' '}({dayCount(approving.from_date, approving.to_date)} days)
          </p>
          <p>Should this leave be paid or unpaid?</p>
          <p className="muted small">
            Paid leave counts towards the employee's paid days for payroll.
            Unpaid leave does not, but is still recorded as authorised leave
            rather than absence.
          </p>
          <div className="row-end gap">
            <Button variant="ghost" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={busyId === approving.id}
              onClick={() => void approve(approving, 'unpaid_leave')}>
              Approve as Unpaid
            </Button>
            <Button variant="success" disabled={busyId === approving.id}
              onClick={() => void approve(approving, 'paid_leave')}>
              Approve as Paid
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
