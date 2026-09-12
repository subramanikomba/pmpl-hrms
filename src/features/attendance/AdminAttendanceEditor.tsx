import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  attendanceApi, attendanceChangeApi, employeesApi, holidayApi, settingsApi,
} from '@/lib/api';
import { daysInMonth, isoDate, monthStart } from '@/lib/payroll';
import { formatDate, monthInputValue, parseMonthInput } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Select, TextInput } from '@/components/ui/Field';
import type { AttendanceChangeRequest, AttendanceStatus } from '@/types/db';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Admin marking and correction of attendance — including the Admin's own.
 *
 * Admins write through the att_admin policy, so unlike the employee flow
 * there is no correction-request round trip: an Admin edit takes effect
 * immediately and is captured by the attendance_audit trigger.
 */
export function AdminAttendanceEditor() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [employeeId, setEmployeeId] = useState(employee?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  const month = parseMonthInput(monthValue) ?? monthStart(today);

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [employees, records, holidays, settings, requests] = await Promise.all([
      employeesApi.listActive(),
      employeeId
        ? attendanceApi.listForMonth(month, employeeId)
        : Promise.resolve([]),
      holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
      settingsApi.get(),
      employeeId
        ? attendanceChangeApi.listFor(employeeId)
        : Promise.resolve([]),
    ]);
    return { employees, records, holidays, settings, requests };
  }, [monthValue, employeeId]);

  if (!employee) return null;

  const employees = q.data?.employees ?? [];
  const records = q.data?.records ?? [];
  const holidayDates = new Set((q.data?.holidays ?? []).map((h) => h.holiday_date));
  const workingDays = q.data?.settings.working_days ?? [1, 2, 3, 4, 5, 6];

  const byDate = new Map(records.map((r) => [r.date, r]));
  const todayIso = isoDate(today);

  // Latest correction request per date, so a rejected day can be re-requested
  // and only the most recent decision is shown.
  const requestByDate = new Map<string, AttendanceChangeRequest>();
  for (const r of q.data?.requests ?? []) {
    const prev = requestByDate.get(r.date);
    if (!prev || r.created_at > prev.created_at) requestByDate.set(r.date, r);
  }

  async function set(date: string, status: AttendanceStatus) {
    if (!employee || !employeeId) return;
    setBusy(date);
    try {
      await attendanceApi.setStatus(employeeId, date, status, employee.id);
      toast.success(`${formatDate(date)} set to ${status.replace('_', ' ')}.`);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update attendance');
    } finally { setBusy(null); }
  }

  const days = Array.from(
    { length: daysInMonth(month) },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1));

  const isSelf = employeeId === employee.id;
  const selfToday = byDate.get(todayIso);

  return (
    <>
      <Card>
        <div className="filter-row">
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
                {e.id === employee.id ? ' (me)' : ''}
              </option>
            ))}
          </Select>
          <TextInput label="Month" type="month" value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)} />
        </div>
      </Card>

      {isSelf && monthValue === monthInputValue(today) && (
        <Card title="My attendance today">
          {/* Same single-row layout as the employee dashboard's Today card. */}
          <div className="today-row">
            <div>
              <div className="today-label">Status</div>
              <div className="today-status">
                {selfToday ? <StatusBadge status={selfToday.status} />
                  : <span className="muted">Not marked</span>}
              </div>
            </div>
            <Button variant="primary"
              disabled={busy === todayIso || selfToday?.status === 'present'}
              onClick={() => void set(todayIso, 'present')}>
              {selfToday?.status === 'present' ? 'Marked Present' : 'Mark Present'}
            </Button>
          </div>
        </Card>
      )}

      <Card title="Mark or correct attendance">
        <p className="muted small">
          Admin changes take effect immediately and are recorded in the
          attendance history. They do not go through the correction approval
          workflow. A day with a correction request pending is decided on the
          Approvals screen instead.
        </p>
        {q.loading ? <Spinner label="Loading attendance…" /> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Day</th><th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const ds = isoDate(d);
                  const rec = byDate.get(ds);
                  const isFuture = ds > todayIso;
                  const isOff = !workingDays.includes(d.getDay());
                  const isHoliday = holidayDates.has(ds);

                  let shown: AttendanceStatus | 'not_marked';
                  if (rec) shown = rec.status;
                  else if (isOff) shown = 'weekly_off';
                  else if (isHoliday) shown = 'company_holiday';
                  else shown = 'not_marked';

                  // Present on a Sunday or holiday: the day is already paid as
                  // an off, so this flags the work behind the weekend allowance.
                  const workedOff = rec?.status === 'present' && (isOff || isHoliday);
                  const req = requestByDate.get(ds);
                  const pendingReq = req?.status === 'pending';

                  return (
                    <tr key={ds} className={isFuture ? 'row-future' : undefined}>
                      <td>{formatDate(d)}</td>
                      <td className="muted">{DOW[d.getDay()]}</td>
                      <td>
                        {shown === 'not_marked'
                          ? <span className="muted">Not marked</span>
                          : <StatusBadge status={shown} />}
                        {workedOff && (
                          <> <Badge tone="info">
                            Worked {isOff ? 'weekly off' : 'holiday'}
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
                        {isFuture ? <span className="muted">—</span>
                          : pendingReq ? (
                            <span className="muted small"
                              title="Decide this on the Approvals screen">
                              Awaiting approval
                            </span>
                          ) : (
                          <div className="row-end gap-sm" style={{ marginTop: 0 }}>
                            <Button
                              size="sm"
                              variant={rec?.status === 'present' ? 'success' : 'secondary'}
                              disabled={busy === ds || rec?.status === 'present'}
                              onClick={() => void set(ds, 'present')}
                            >
                              Present
                            </Button>
                            <Button
                              size="sm"
                              variant={rec?.status === 'absent' ? 'danger' : 'secondary'}
                              disabled={busy === ds || rec?.status === 'absent'}
                              onClick={() => void set(ds, 'absent')}
                            >
                              Absent
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
