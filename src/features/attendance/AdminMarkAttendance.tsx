import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { attendanceApi, employeesApi, holidayApi, settingsApi } from '@/lib/api';
import { isoDate, monthStart } from '@/lib/payroll';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Select, TextInput } from '@/components/ui/Field';
import type { AttendanceStatus } from '@/types/db';

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'paid_leave', label: 'Paid Leave' },
  { value: 'weekly_off', label: 'Weekly Off' },
  { value: 'company_holiday', label: 'Company Holiday' },
];

/**
 * Admin marking of attendance — including the Admin's own.
 *
 * Admins are employees too and were previously unable to mark themselves,
 * since the employee Attendance screen is not on their navigation. Writes go
 * through the same attendanceApi.setStatus and the same admin RLS policy used
 * elsewhere; the approval workflow for employee self-corrections is untouched,
 * because an Admin edit is already an authorised decision.
 */
export function AdminMarkAttendance({ onChanged }: { onChanged?: () => void }) {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);

  const [date, setDate] = useState(isoDate(today));
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery(async () => {
    const month = monthStart(new Date(date));
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [employees, records, holidays, settings] = await Promise.all([
      employeesApi.listActive(),
      attendanceApi.listForMonth(month),
      holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
      settingsApi.get(),
    ]);
    return { employees, records, holidays, settings };
  }, [date]);

  if (!employee) return null;
  if (q.loading) return <Spinner label="Loading attendance…" />;
  if (q.error || !q.data) {
    return <Card><p className="error-text">{q.error ?? 'Could not load'}</p></Card>;
  }

  const { employees, records, holidays, settings } = q.data;
  const byEmployee = new Map(
    records.filter((r) => r.date === date).map((r) => [r.employee_id, r.status]));

  const d = new Date(`${date}T00:00:00`);
  const isWorkingDay = (settings.working_days ?? [1, 2, 3, 4, 5, 6]).includes(d.getDay());
  const holiday = holidays.find((h) => h.holiday_date === date);
  const isFuture = date > isoDate(today);

  async function set(employeeId: string, status: AttendanceStatus) {
    if (!employee) return;
    setBusy(employeeId);
    try {
      await attendanceApi.setStatus(employeeId, date, status, employee.id);
      toast.success(`${formatDate(date)} updated.`);
      q.reload();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update attendance');
    } finally { setBusy(null); }
  }

  return (
    <>
      <Card title="Select a date">
        <TextInput label="Date" type="date" value={date} max={isoDate(today)}
          onChange={(e) => setDate(e.target.value)} />
        {!isWorkingDay && (
          <p className="muted small">
            {formatDate(date)} is a weekly off. Mark Present only if the
            employee actually worked.
          </p>
        )}
        {holiday && (
          <p className="muted small">
            Company holiday: {holiday.name}.
          </p>
        )}
        {isFuture && (
          <p className="callout-warn">Attendance cannot be set for a future date.</p>
        )}
      </Card>

      <Card title={`Attendance — ${formatDate(date)}`}>
        <div className="table-scroll">
          <table className="data-table table-compact">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Set</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const status = byEmployee.get(e.id);
                const isSelf = e.id === employee.id;
                return (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.employee_code}</strong>
                      {isSelf && <span className="muted"> (you)</span>}
                      <div className="emp-name">{e.first_name} {e.last_name}</div>
                    </td>
                    <td>
                      {status
                        ? <StatusBadge status={status} />
                        : <span className="muted">Not marked</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Select label="" value={status ?? ''}
                        disabled={busy === e.id || isFuture}
                        onChange={(ev) => {
                          const v = ev.target.value as AttendanceStatus | '';
                          if (v) void set(e.id, v);
                        }}>
                        <option value="">— Select —</option>
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {byEmployee.size === 0 && !isFuture && (
          <p className="muted small">
            Nobody has marked attendance for this date yet.
          </p>
        )}
      </Card>

      <div className="row-end gap">
        <Button variant="secondary" onClick={() => setDate(isoDate(today))}>
          Go to today
        </Button>
      </div>
    </>
  );
}
