import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import {
  attendanceApi, holidayApi, leaveApi, advanceApi, expenseApi,
} from '@/lib/api';
import { computePaidDays, isoDate, monthStart } from '@/lib/payroll';
import { formatCurrency, formatDate, formatMonth } from '@/lib/format';
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
  const month = useMemo(() => monthStart(today), [today]);
  const employeeId = employee?.id ?? '';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const q = useQuery(async () => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const [records, holidays, leaves, ledger, expenses] = await Promise.all([
      attendanceApi.listForMonth(month, employeeId),
      holidayApi.listBetween(isoDate(month), isoDate(monthEnd)),
      leaveApi.listFor(employeeId),
      advanceApi.ledgerFor(employeeId),
      expenseApi.listFor(employeeId),
    ]);
    return { records, holidays, leaves, ledger, expenses };
  }, [employeeId]);

  if (!employee) return null;
  if (q.loading) return <Spinner label="Loading your attendance…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;

  const { records = [], holidays = [], leaves = [], ledger = [], expenses = [] } = q.data ?? {};
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const breakdown = computePaidDays({ month, records, holidayDates, upTo: today });

  const todayStr = isoDate(today);
  const todayRecord = records.find((r) => r.date === todayStr);
  const isSunday = today.getDay() === 0;
  const isHoliday = holidayDates.has(todayStr);
  const alreadyPresent = todayRecord?.status === 'present';

  const outstandingAdvance = ledger.length > 0
    ? (ledger[ledger.length - 1]?.running_balance ?? 0)
    : 0;

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
    if (from <= todayStr) {
      toast.error('Leave can only be applied for future dates.');
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
            </div>
          </div>
          <Button
            variant="primary"
            disabled={saving || isSunday || isHoliday || alreadyPresent}
            onClick={() => void markPresent()}
          >
            {alreadyPresent ? 'Marked Present'
              : isSunday ? 'Weekly Off'
              : isHoliday ? 'Company Holiday'
              : 'Mark Present'}
          </Button>
        </div>
      </Card>

      {outstandingAdvance > 0 && (
        <Card className="callout-warn">
          Outstanding company advance: <strong>{formatCurrency(outstandingAdvance)}</strong>
        </Card>
      )}

      <Card title="Apply for leave">
        <div className="form-grid-2">
          <TextInput
            label="From date" type="date" value={from}
            onChange={(e) => setFrom(e.target.value)} min={todayStr}
          />
          <TextInput
            label="To date" type="date" value={to}
            onChange={(e) => setTo(e.target.value)} min={from || todayStr}
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

      {(pendingLeaves.length > 0 || pendingExpenses.length > 0) && (
        <Card title="Awaiting approval">
          <ul className="plain-list">
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

      <Card title="Recent attendance">
        {records.length === 0 ? (
          <p className="muted">No attendance recorded this month yet.</p>
        ) : (
          <ul className="record-list">
            {records.slice(0, 10).map((r) => (
              <li key={r.id}>
                <span>{formatDate(r.date)}</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
