import { useMemo, useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { attendanceApi, attendanceChangeApi, holidayApi } from '@/lib/api';
import { AttendanceMonthTable } from './AttendanceMonthTable';
import {
  ATTENDANCE_EDIT_CUTOFF_DAY, employeeMayMark, isoDate, monthStart,
} from '@/lib/payroll';
import { formatMonth } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

/**
 * The employee's month-by-month attendance grid.
 *
 * This component owns its own month state and its own data. That is the
 * point: switching to the previous month here must not move the dashboard
 * summary, payment details or anything else on the page to that month. The
 * parent passes no month in and gets no month back — there is deliberately
 * no shared/global month state.
 */
export function AttendanceMonthSection(
  { employeeId, workingDays }: { employeeId: string; workingDays?: readonly number[] },
) {
  const today = useMemo(() => new Date(), []);
  const currentMonth = useMemo(() => monthStart(today), [today]);
  const previousMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() - 1, 1), [today]);

  // The previous month is offered only while it is still editable.
  const previousMonthOpen = employeeMayMark(previousMonth, today);
  const [showPrevious, setShowPrevious] = useState(false);
  const viewingPrevious = showPrevious && previousMonthOpen;
  const month = viewingPrevious ? previousMonth : currentMonth;
  void workingDays;

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [records, holidays, requests] = await Promise.all([
      attendanceApi.listForMonth(month, employeeId),
      holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
      attendanceChangeApi.listFor(employeeId),
    ]);
    return { records, holidays, requests };
  }, [employeeId, isoDate(month)]);

  const records = q.data?.records ?? [];
  const holidayDates = new Set((q.data?.holidays ?? []).map((h) => h.holiday_date));
  const requests = q.data?.requests ?? [];

  return (
    <Card
      title={`Attendance — ${formatMonth(month)}`}
      actions={previousMonthOpen ? (
        <div className="row-end gap-sm" style={{ marginTop: 0 }}>
          <Button
            size="sm"
            variant={!viewingPrevious ? 'primary' : 'secondary'}
            onClick={() => setShowPrevious(false)}
          >
            {formatMonth(currentMonth)}
          </Button>
          <Button
            size="sm"
            variant={viewingPrevious ? 'primary' : 'secondary'}
            onClick={() => setShowPrevious(true)}
          >
            {formatMonth(previousMonth)}
          </Button>
        </div>
      ) : undefined}
    >
      <p className="muted small" style={{ marginBottom: 10 }}>
        You can mark Present or Absent for past dates in this month, including
        Sundays and company holidays if you actually worked them. Changing a
        past day to Present is sent to Admin for approval. Approved leave is
        set automatically and cannot be changed here.
      </p>
      {previousMonthOpen && (
        <p className="callout-warn" style={{ marginBottom: 10 }}>
          {formatMonth(previousMonth)} attendance can still be corrected until
          the {ATTENDANCE_EDIT_CUTOFF_DAY}th of {formatMonth(currentMonth)}.
        </p>
      )}
      {q.loading ? <Spinner label="Loading attendance…" />
        : q.error ? <p className="error-text">{q.error}</p>
        : (
          <AttendanceMonthTable
            employeeId={employeeId}
            month={month}
            records={records}
            holidayDates={holidayDates}
            requests={requests}
            onChanged={q.reload}
          />
        )}
    </Card>
  );
}
