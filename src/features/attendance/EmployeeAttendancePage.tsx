import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  attendanceApi, attendanceChangeApi, holidayApi, leaveApi, advanceApi,
  expenseApi, settingsApi,
} from '@/lib/api';
import { AttendanceMonthSection } from './AttendanceMonthSection';
import {
  computePaidDays, earliestLeaveDate, isoDate, monthStart,
  LEAVE_BACKDATE_CUTOFF_DAY,
} from '@/lib/payroll';
import { formatCurrency, formatDate, formatMonth, ordinalDay } from '@/lib/format';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/Field';

export function EmployeeAttendancePage() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  // The dashboard is always the CURRENT month. The attendance grid owns its
  // own month locally (see AttendanceMonthSection) so viewing a past month
  // there never moves the summary or the payment details.
  const month = useMemo(() => monthStart(today), [today]);
  const employeeId = employee?.id ?? '';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [records, holidays, leaves, ledger, expenses, settings, requests] =
      await Promise.all([
        attendanceApi.listForMonth(month, employeeId),
        holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
        leaveApi.listFor(employeeId),
        advanceApi.ledgerFor(employeeId),
        expenseApi.listFor(employeeId),
        settingsApi.get(),
        attendanceChangeApi.listFor(employeeId),
      ]);
    return { records, holidays, leaves, ledger, expenses, settings, requests };
  }, [employeeId]);

  if (!employee) return null;
  if (q.loading) return <Spinner label="Loading your attendance…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;

  const {
    records = [], holidays = [], leaves = [], ledger = [], expenses = [],
    requests = [],
  } = q.data ?? {};
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const breakdown = computePaidDays({ month, records, holidayDates, upTo: today,
    workingDays: q.data?.settings.working_days });

  const todayStr = isoDate(today);
  const todayRecord = records.find((r) => r.date === todayStr);
  const isSunday = today.getDay() === 0;
  const isHoliday = holidayDates.has(todayStr);
  const alreadyPresent = todayRecord?.status === 'present';
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  // Leave may be applied for any day from the earliest open date onwards. That
  // is the start of the previous month until the 10th of this one, so leave can
  // be regularised before payroll is run; the start of this month afterwards.
  const earliestLeave = earliestLeaveDate(today);
  const earliestLeaveStr = isoDate(earliestLeave);
  const prevMonthOpen = earliestLeave < monthStart(today);

  const outstandingAdvance = ledger.length > 0
    ? (ledger[ledger.length - 1]?.running_balance ?? 0)
    : 0;
  // Only to get the singular right: "a company advance" reads as a mistake
  // when there is one, and the line is meant to be taken seriously.
  const advanceCount = ledger.filter((l) => l.txn_type === 'advance').length;

  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const pendingExpenses = expenses.filter((e) => e.status === 'pending');

  async function markPresent() {
    setSaving(true);
    try {
      await attendanceApi.markPresent(employeeId, todayStr);
      toast.success('Marked present for today.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark attendance');
    } finally {
      setSaving(false);
    }
  }

  async function applyLeave() {
    if (!from) { toast.error('Choose a start date for your leave.'); return; }
    const end = to || from;
    // Past dates are allowed back to the earliest open date, so a day already
    // taken off can be regularised as leave rather than being left as Absent.
    // Older months are closed; the same bound is enforced by RLS.
    if (from < earliestLeaveStr) {
      toast.error(
        prevMonthOpen
          ? `Leave can be applied for dates from ${formatDate(earliestLeaveStr)} `
            + 'onwards. For an earlier month, please ask Admin.'
          : `Last month closed for leave applications on the `
            + `${LEAVE_BACKDATE_CUTOFF_DAY}th. For an earlier month, please ask Admin.`,
      );
      return;
    }
    if (end < from) { toast.error('The end date cannot be before the start date.'); return; }
    setSaving(true);
    try {
      await leaveApi.apply({ employee_id: employeeId, from_date: from, to_date: end, reason });
      toast.success('Leave request submitted for approval.');
      setFrom(''); setTo(''); setReason('');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit leave');
    } finally {
      setSaving(false);
    }
  }

  const todayLabel = isSunday ? 'Weekly Off (Sunday)'
    : isHoliday ? 'Company Holiday'
    : todayRecord ? todayRecord.status
    : 'Not marked';

  return (
    <>
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        subtitle={`${formatMonth(month)} · Today is ${formatDate(today)}`}
      />

      <div className="stat-grid">
        <StatCard label="Present" value={breakdown.present} />
        <StatCard label="Paid Leave" value={breakdown.paidLeave} />
        <StatCard label="Weekly Offs" value={breakdown.weeklyOffs} />
        <StatCard label="Holidays" value={breakdown.companyHolidays} />
        <StatCard label="Paid Days" value={breakdown.paidDays} tone="good" />
      </div>

      <Card title="Today">
        <div className="today-row">
          <div>
            <div className="today-label">Status</div>
            <div className="today-status">
              {todayRecord ? <StatusBadge status={todayRecord.status} /> : todayLabel}
              {alreadyPresent && (isSunday || isHoliday) && (
                <> <Badge tone="info">
                  Worked {isSunday ? 'weekly off' : 'holiday'}
                </Badge></>
              )}
            </div>
          </div>
          <Button
            variant="primary"
            disabled={saving || alreadyPresent}
            onClick={() => void markPresent()}
          >
            {alreadyPresent ? 'Marked Present'
              : isSunday || isHoliday ? 'Mark Present (working today)'
              : 'Mark Present'}
          </Button>
        </div>
      </Card>

      {/*
        * Addressed to the employee, not written as a ledger label: "you hold"
        * names who is responsible, and the second line names the one action
        * that discharges it. "Hold" is deliberate — an advance is company cash
        * in the employee's custody, not a debt, so nothing here says "owe".
        */}
      {outstandingAdvance > 0 && (
        <Card className="callout-warn">
          <p>
            You currently hold <strong>{formatCurrency(outstandingAdvance)}</strong>
            {' '}in {advanceCount === 1 ? 'a company advance' : 'company advances'}.
          </p>
          <p className="advance-action">
            Submit your bills to account for it before payroll on the{' '}
            {ordinalDay(q.data?.settings.salary_payment_day ?? 10)}.
            <Link to="/expenses">Submit a bill →</Link>
          </p>
        </Card>
      )}

      <Card title="Apply for leave">
        <p className="muted small">
          You can apply for a future date, or for a past day you were away — for
          example a day taken off in lieu of working a Sunday. Admin approves it,
          and approved leave counts as a paid day.
        </p>
        <p className="muted small">
          {prevMonthOpen
            ? `${formatMonth(earliestLeave)} is still open, until the `
              + `${LEAVE_BACKDATE_CUTOFF_DAY}th of this month, so leave can be `
              + 'adjusted before payroll is run.'
            : `Last month closed for leave applications on the `
              + `${LEAVE_BACKDATE_CUTOFF_DAY}th. For an earlier month, please `
              + 'ask Admin.'}
        </p>
        <div className="form-grid-2">
          <TextInput
            label="From date *" type="date" value={from}
            onChange={(e) => setFrom(e.target.value)} min={earliestLeaveStr}
          />
          <TextInput
            label="To date" type="date" value={to}
            onChange={(e) => setTo(e.target.value)} min={from || earliestLeaveStr}
            hint="Leave blank for a single day"
          />
        </div>
        <TextInput
          label="Reason (optional)" value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="Reason for leave"
        />
        <Button variant="primary" disabled={saving} onClick={() => void applyLeave()}>
          Submit leave request
        </Button>
      </Card>

      {(pendingLeaves.length > 0 || pendingExpenses.length > 0
        || pendingRequests.length > 0) && (
        <Card title="Awaiting approval">
          <ul className="plain-list">
            {pendingRequests.map((r) => (
              <li key={r.id}>
                Attendance correction to Present on {formatDate(r.date)}
                <StatusBadge status={r.status} />
              </li>
            ))}
            {pendingLeaves.map((l) => (
              <li key={l.id}>
                Leave {formatDate(l.from_date)} – {formatDate(l.to_date)}
                <StatusBadge status={l.status} />
              </li>
            ))}
            {pendingExpenses.map((e) => (
              <li key={e.id}>
                Expense {formatCurrency(e.amount)} on {formatDate(e.expense_date)}
                <StatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AttendanceMonthSection
        employeeId={employeeId}
        workingDays={q.data?.settings.working_days}
      />
    </>
  );
}
