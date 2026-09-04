import { useState } from 'react';
import { attendanceApi, attendanceChangeApi } from '@/lib/api';
import {
  daysInMonth, employeeMayMark, isoDate, needsPresentApproval,
} from '@/lib/payroll';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/ToastProvider';
import type {
  AttendanceChangeRequest, AttendanceRecord, AttendanceStatus,
} from '@/types/db';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface Props {
  employeeId: string;
  month: Date;
  records: readonly AttendanceRecord[];
  holidayDates: ReadonlySet<string>;
  /** The employee's own change requests, used to show per-day request state. */
  requests: readonly AttendanceChangeRequest[];
  onChanged: () => void;
}

/**
 * Month view of the employee's own attendance.
 *
 * Present/Absent can be set for any date the edit window still allows,
 * including Sundays and company holidays — employees do sometimes work those
 * days, and payroll needs the record to award the weekend/holiday allowance.
 * Approved leave stays read-only so the leave workflow is not bypassed.
 *
 * Marking Present for a PAST date does not take effect immediately: it raises
 * an Admin approval request. Today's own attendance is still marked directly.
 */
export function AttendanceMonthTable(
  { employeeId, month, records, holidayDates, requests, onChanged }: Props,
) {
  const toast = useToast();
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const today = new Date();
  const total = daysInMonth(month);
  const byDate = new Map<string, AttendanceRecord>();
  for (const r of records) byDate.set(r.date, r);

  // Latest request per date, so a rejected day can be requested again.
  const requestByDate = new Map<string, AttendanceChangeRequest>();
  for (const r of requests) {
    const prev = requestByDate.get(r.date);
    if (!prev || r.created_at > prev.created_at) requestByDate.set(r.date, r);
  }

  const days = Array.from({ length: total }, (_, i) =>
    new Date(month.getFullYear(), month.getMonth(), i + 1));

  async function set(d: Date, status: 'present' | 'absent') {
    const ds = isoDate(d);
    setBusyDate(ds);
    try {
      // A past date moving to Present goes through Admin approval.
      if (status === 'present' && needsPresentApproval(d, today)) {
        await attendanceChangeApi.raise({
          employee_id: employeeId,
          date: ds,
          from_status: byDate.get(ds)?.status ?? null,
          reason: null,
        });
        toast.success(`Correction requested for ${formatDate(ds)}. Awaiting Admin approval.`);
      } else {
        await attendanceApi.selfMark(employeeId, ds, status);
        toast.success(`${formatDate(ds)} marked ${status}.`);
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update attendance');
    } finally {
      setBusyDate(null);
    }
  }

  async function withdraw(req: AttendanceChangeRequest) {
    setBusyDate(req.date);
    try {
      await attendanceChangeApi.withdraw(req.id);
      toast.info('Correction request withdrawn.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not withdraw the request');
    } finally {
      setBusyDate(null);
    }
  }

  return (
    <div className="table-scroll">
      <table className="data-table table-compact">
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const ds = isoDate(d);
            const rec = byDate.get(ds);
            const isSunday = d.getDay() === 0;
            const isHoliday = holidayDates.has(ds);
            const isFuture = ds > isoDate(today);
            const req = requestByDate.get(ds);
            const pendingReq = req?.status === 'pending';

            // Off-days are now editable; approved leave is not, and neither is
            // a day with a request already awaiting a decision.
            const editable = !isFuture
              && rec?.status !== 'paid_leave'
              && !pendingReq
              && employeeMayMark(d, today);

            // Displayed status: an explicit record wins, then calendar rules.
            let status: AttendanceStatus | 'not_marked';
            if (rec) status = rec.status;
            else if (isSunday) status = 'weekly_off';
            else if (isHoliday) status = 'company_holiday';
            else status = 'not_marked';

            // A present mark on an off-day is shown as worked, so the employee
            // can see the day that will earn the weekend/holiday allowance.
            const workedOff = rec?.status === 'present' && (isSunday || isHoliday);

            return (
              <tr key={ds} className={isFuture ? 'row-future' : undefined}>
                <td>{formatDate(d)}</td>
                <td className="muted">{DOW[d.getDay()]}</td>
                <td>
                  {status === 'not_marked'
                    ? <span className="muted">Not marked</span>
                    : <StatusBadge status={status} />}
                  {workedOff && (
                    <> <Badge tone="info">
                      Worked {isSunday ? 'weekly off' : 'holiday'}
                    </Badge></>
                  )}
                  {pendingReq && (
                    <> <Badge tone="warn">Correction requested</Badge></>
                  )}
                  {req?.status === 'rejected' && rec?.status !== 'present' && (
                    <> <Badge tone="danger">Correction rejected</Badge></>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {pendingReq && req ? (
                    <Button size="sm" variant="ghost" disabled={busyDate === ds}
                      onClick={() => void withdraw(req)}>
                      Withdraw
                    </Button>
                  ) : editable ? (
                    <div className="row-end gap-sm" style={{ marginTop: 0 }}>
                      <Button
                        size="sm"
                        variant={rec?.status === 'present' ? 'success' : 'secondary'}
                        disabled={busyDate === ds || rec?.status === 'present'}
                        onClick={() => void set(d, 'present')}
                        title={needsPresentApproval(d, today)
                          ? 'Sends a correction request to Admin'
                          : undefined}
                      >
                        Present
                      </Button>
                      <Button
                        size="sm"
                        variant={rec?.status === 'absent' ? 'danger' : 'secondary'}
                        disabled={busyDate === ds}
                        onClick={() => void set(d, 'absent')}
                      >
                        Absent
                      </Button>
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
