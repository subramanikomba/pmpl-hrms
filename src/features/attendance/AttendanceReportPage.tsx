import { useMemo, useState } from 'react';
import { AdminAttendanceEditor } from './AdminAttendanceEditor';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@/lib/useQuery';
import { attendanceApi, employeesApi, holidayApi, settingsApi } from '@/lib/api';
import {
  computePaidDays, daysInMonth, findUnmarkedAttendance, isoDate, monthStart,
} from '@/lib/payroll';
import { formatDate, monthInputValue, parseMonthInput } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, TextInput } from '@/components/ui/Field';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Compact per-day cell code used in the grid. */
type CellKind =
  | 'present' | 'leave' | 'weekly' | 'holiday' | 'absent' | 'unmarked' | 'future';
const CELL_TEXT: Record<CellKind, string> = {
  present: 'P', leave: 'PL', weekly: 'WO', holiday: 'CH', absent: 'A',
  // Not the same as Absent: nobody recorded anything for this day.
  unmarked: 'NM', future: '·',
};

export function AttendanceReportPage() {
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [employeeId, setEmployeeId] = useState('');

  const month = parseMonthInput(monthValue) ?? monthStart(today);

  const [tab, setTab] = useState<'report' | 'mark'>('report');
  const [params] = useSearchParams();
  // Opened from the dashboard's "Attendance not marked today" line.
  const focusDate = params.get('date');
  const showExceptions = params.get('exceptions') === '1';

  const emps = useQuery(() => employeesApi.listActive(), []);
  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [records, holidays, settings] = await Promise.all([
      attendanceApi.listForMonth(month, employeeId || undefined),
      holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
      settingsApi.get(),
    ]);
    return { records, holidays, settings };
  }, [monthValue, employeeId]);

  const employees = (emps.data ?? []).filter((e) => !employeeId || e.id === employeeId);
  const total = daysInMonth(month);
  const days = Array.from({ length: total }, (_, i) =>
    new Date(month.getFullYear(), month.getMonth(), i + 1));
  const holidayDates = new Set((q.data?.holidays ?? []).map((h) => h.holiday_date));
  const workingSet = new Set(q.data?.settings.working_days ?? [1, 2, 3, 4, 5, 6]);
  const todayStr = isoDate(today);

  const byEmployee = new Map<string, Map<string, string>>();
  for (const r of q.data?.records ?? []) {
    const m = byEmployee.get(r.employee_id) ?? new Map<string, string>();
    m.set(r.date, r.status);
    byEmployee.set(r.employee_id, m);
  }

  function cellKind(empId: string, d: Date): CellKind {
    const ds = isoDate(d);
    const status = byEmployee.get(empId)?.get(ds);
    if (!workingSet.has(d.getDay())) return 'weekly';
    if (status === 'present') return 'present';
    if (status === 'paid_leave') return 'leave';
    if (holidayDates.has(ds) || status === 'company_holiday') return 'holiday';
    if (status === 'weekly_off') return 'weekly';
    if (ds > todayStr) return 'future';
    // Absent is a recorded decision; no record at all is a distinct state and
    // must never be displayed as Absent — daily-wage pay depends on it.
    if (status === 'absent') return 'absent';
    return 'unmarked';
  }

  return (
    <>
      <PageHeader title="Attendance"
        subtitle="Month-wise attendance for all employees, and marking" />

      <div className="tabbar" role="tablist" aria-label="Attendance views">
        <button role="tab" aria-selected={tab === 'report'}
          className={`tab ${tab === 'report' ? 'is-active' : ''}`}
          onClick={() => setTab('report')}>
          Attendance report
        </button>
        <button role="tab" aria-selected={tab === 'mark'}
          className={`tab ${tab === 'mark' ? 'is-active' : ''}`}
          onClick={() => setTab('mark')}>
          Mark / correct attendance
        </button>
      </div>

      {tab === 'mark' ? <AdminAttendanceEditor /> : (<>

      {showExceptions && q.data && (() => {
        const unmarked = findUnmarkedAttendance({
          employeeIds: (emps.data ?? []).map((e) => e.id),
          records: q.data.records,
          month,
          holidayDates,
          workingDays: q.data.settings.working_days,
          cutoffTime: q.data.settings.attendance_cutoff_time,
          ignoreCutoff: true,
          now: today,
        }).filter((x) => !focusDate || x.date === focusDate);

        return (
          <Card title={`Attendance not marked${
            focusDate ? ` — ${formatDate(focusDate)}` : ''} (${unmarked.length})`}>
            {unmarked.length === 0 ? (
              <p className="muted">
                Every employee's attendance is recorded for this day.
              </p>
            ) : (
              <>
                <p className="muted small">
                  These days have no attendance record. They are neither Present
                  nor Absent — resolve each one in the grid below.
                </p>
                <ul className="plain-list">
                  {unmarked.map((x) => {
                    const e = (emps.data ?? []).find((y) => y.id === x.employeeId);
                    return (
                      <li key={`${x.employeeId}-${x.date}`}>
                        <span>
                          {e ? `${e.first_name} ${e.last_name}` : x.employeeId}
                          {' — '}{formatDate(x.date)}
                        </span>
                        <strong className="count-pending">Attendance Not Marked</strong>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>
        );
      })()}

      <Card title="Filters">
        <div className="form-grid-2">
          <TextInput label="Month" type="month" value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)} />
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {(emps.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {q.loading ? <Spinner label="Loading attendance…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (
          <Card>
            <div className="table-scroll">
              <table className="attendance-grid">
                <thead>
                  <tr>
                    <th className="emp-col">Employee</th>
                    {days.map((d) => (
                      <th key={d.getDate()}
                        className={!workingSet.has(d.getDay()) ? 'is-sunday'
                          : holidayDates.has(isoDate(d)) ? 'is-holiday' : ''}>
                        <span className="d-num">{d.getDate()}</span>
                        <span className="d-dow">{DOW[d.getDay()]}</span>
                      </th>
                    ))}
                    <th className="sum-col">P</th>
                    <th className="sum-col">PL</th>
                    <th className="sum-col">WO</th>
                    <th className="sum-col">CH</th>
                    <th className="sum-col is-paid">Paid</th>
                    <th className="sum-col">Abs</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr><td colSpan={total + 7} className="table-empty">No employees.</td></tr>
                  ) : employees.map((emp) => {
                    const records = (q.data?.records ?? [])
                      .filter((r) => r.employee_id === emp.id);
                    const b = computePaidDays({ month, records, holidayDates, upTo: today,
                      workingDays: q.data?.settings.working_days });
                    return (
                      <tr key={emp.id}>
                        <td className="emp-col">
                          <strong>{emp.employee_code}</strong>
                          <span className="emp-name">{emp.first_name} {emp.last_name}</span>
                        </td>
                        {days.map((d) => {
                          const kind = cellKind(emp.id, d);
                          return (
                            <td key={d.getDate()} className={`att-cell cell-${kind}`}
                              title={isoDate(d)}>
                              {CELL_TEXT[kind]}
                            </td>
                          );
                        })}
                        <td className="sum-col">{b.present}</td>
                        <td className="sum-col">{b.paidLeave}</td>
                        <td className="sum-col">{b.weeklyOffs}</td>
                        <td className="sum-col">{b.companyHolidays}</td>
                        <td className="sum-col is-paid">{b.paidDays}</td>
                        <td className="sum-col text-danger">{b.absent}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="legend">
              <span className="att-cell cell-present">P</span> Present
              <span className="att-cell cell-leave">PL</span> Paid leave
              <span className="att-cell cell-weekly">WO</span> Weekly off
              <span className="att-cell cell-holiday">CH</span> Company holiday
              <span className="att-cell cell-absent">A</span> Absent
              <span className="att-cell cell-unmarked">NM</span> Not marked
            </div>
          </Card>
        )}
    </>)}
    </>
  );
}
