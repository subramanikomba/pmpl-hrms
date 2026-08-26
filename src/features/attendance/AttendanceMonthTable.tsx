import { useState } from 'react';
import { attendanceApi } from '@/lib/api';
import {
  daysInMonth, employeeMayMark, isoDate,
} from '@/lib/payroll';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/ToastProvider';
import type { AttendanceRecord, AttendanceStatus } from '@/types/db';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface Props {
  employeeId: string;
  month: Date;
  records: readonly AttendanceRecord[];
  holidayDates: ReadonlySet<string>;
  paymentDay: number;
  onChanged: () => void;
}

/**
 * Month view of the employee's own attendance. Present/Absent can be set or
 * corrected for any date the RLS window still allows; Sundays, company
 * holidays and approved leave stay read-only so existing payroll rules and
 * the leave workflow are not bypassed.
 */
export function AttendanceMonthTable(
  { employeeId, month, records, holidayDates, paymentDay, onChanged }: Props,
) {
  const toast = useToast();
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const today = new Date();
  const total = daysInMonth(month);
  const byDate = new Map<string, AttendanceRecord>();
  for (const r of records) byDate.set(r.date, r);

  const days = Array.from({ length: total }, (_, i) =>
    new Date(month.getFullYear(), month.getMonth(), i + 1));

  async function set(date: string, status: 'present' | 'absent') {
    setBusyDate(date);
    try {
      await attendanceApi.selfMark(employeeId, date, status);
      toast.success(`${formatDate(date)} marked ${status}.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update attendance');
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
            const editable = !isSunday && !isHoliday && !isFuture
              && rec?.status !== 'paid_leave'
              && employeeMayMark(d, paymentDay, today);

            // Displayed status: explicit record wins, then calendar rules.
            let status: AttendanceStatus | 'not_marked';
            if (isSunday) status = 'weekly_off';
            else if (rec) status = rec.status;
            else if (isHoliday) status = 'company_holiday';
            else if (isFuture) status = 'not_marked';
            else status = 'not_marked';

            return (
              <tr key={ds} className={isFuture ? 'row-future' : undefined}>
                <td>{formatDate(d)}</td>
                <td className="muted">{DOW[d.getDay()]}</td>
                <td>
                  {status === 'not_marked'
                    ? <span className="muted">Not marked</span>
                    : <StatusBadge status={status} />}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {editable ? (
                    <div className="row-end gap-sm" style={{ marginTop: 0 }}>
                      <Button
                        size="sm"
                        variant={rec?.status === 'present' ? 'success' : 'secondary'}
                        disabled={busyDate === ds}
                        onClick={() => void set(ds, 'present')}
                      >
                        Present
                      </Button>
                      <Button
                        size="sm"
                        variant={rec?.status === 'absent' ? 'danger' : 'secondary'}
                        disabled={busyDate === ds}
                        onClick={() => void set(ds, 'absent')}
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
