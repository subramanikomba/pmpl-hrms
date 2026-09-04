import { Link } from 'react-router-dom';
import { useQuery } from '@/lib/useQuery';
import {
  advanceApi, attendanceApi, attendanceChangeApi, employeesApi, expenseApi,
  holidayApi, leaveApi, outdoorVisitApi, payrollApi, settingsApi,
} from '@/lib/api';
import { isoDate, monthStart } from '@/lib/payroll';
import { countVisitsForMonth } from '@/lib/visits';
import { formatCurrency, formatDate, formatMonth } from '@/lib/format';
import { Card, StatCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';

export function AdminDashboardPage() {
  const q = useQuery(async () => {
    const today = new Date();
    const month = monthStart(today);
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const [
      employees, todayAtt, monthHolidays, pendingLeave, pendingExp, payroll,
      advances, accounted, pendingCorrections, pendingVisits, monthVisits,
      previousPayroll, settings,
    ] = await Promise.all([
      employeesApi.listActive(),
      attendanceApi.listForMonth(month),
      holidayApi.listBetween(isoDate(month),
        isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))),
      leaveApi.listAll('pending'),
      expenseApi.listAll({ status: 'pending' }),
      payrollApi.listForMonth(month),
      advanceApi.listAll(),
      expenseApi.listAll({ status: 'approved' }),
      attendanceChangeApi.listAll('pending'),
      outdoorVisitApi.listPending(),
      outdoorVisitApi.listForMonth(month),
      payrollApi.listForMonthWithEmployee(previousMonth),
      settingsApi.get(),
    ]);
    const todayStr = isoDate(today);
    return {
      employees,
      presentToday: todayAtt.filter((a) => a.date === todayStr && a.status === 'present').length,
      onLeaveToday: todayAtt.filter((a) => a.date === todayStr && a.status === 'paid_leave').length,
      pendingLeave, pendingExp, payroll, month,
      pendingCorrections, pendingVisits, monthVisits, previousPayroll,
      previousMonth, settings, today,
      monthHolidays, todayAtt,
      outstandingAdvance:
        advances.reduce((s, a) => s + Number(a.amount), 0)
        - accounted.reduce((s, e) => s + Number(e.accounted_amount ?? 0), 0),
    };
  }, []);

  if (q.loading) return <Spinner label="Loading dashboard…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (!q.data) return null;

  const d = q.data;
  const netPayable = d.payroll.reduce((s, p) => s + Number(p.net_salary), 0);
  const processed = d.payroll.filter((p) => p.status !== 'draft').length;

  // Previous month's settlement. The payroll date comes from the configured
  // cycle (payment day of the FOLLOWING month), never a hard-coded date.
  const prev = d.previousPayroll;
  const prevTotal = prev.reduce((s, p) => s + Number(p.net_salary), 0);
  // Company-level position: paid means the payment was actually recorded,
  // never merely that payroll was finalised. This is deliberately NOT the
  // per-employee status shown in the employee portal.
  const paidRows = prev.filter((p) => p.status === 'paid' && p.payment_date);
  const paidAmount = paidRows.reduce((s, p) => s + Number(p.net_salary), 0);
  const outstandingAmount = Math.max(0, prevTotal - paidAmount);
  const companyStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'none' =
    prev.length === 0 ? 'none'
      : paidRows.length === 0 ? 'unpaid'
        : paidRows.length === prev.length ? 'fully_paid'
          : 'partially_paid';
  const STATUS_TEXT = {
    none: 'Not processed', unpaid: 'Unpaid',
    partially_paid: 'Partially paid', fully_paid: 'Fully paid',
  } as const;
  // Today's unmarked attendance is shown live, without waiting for the
  // end-of-day cutoff — Admin wants to see it during the day. The cutoff
  // still governs the month-wide exception detection used by the Attendance
  // screen and the pre-payroll warning.
  const todayIso = isoDate(d.today);
  const todayDow = d.today.getDay();
  const workingToday =
    (d.settings.working_days ?? [1, 2, 3, 4, 5, 6]).includes(todayDow)
    && !d.monthHolidays.some((h) => h.holiday_date === todayIso);
  const markedTodayIds = new Set(
    d.todayAtt.filter((a) => a.date === todayIso).map((a) => a.employee_id));
  const unmarkedToday = workingToday
    ? d.employees.filter((e) => !markedTodayIds.has(e.id)).length
    : 0;
  // Everything listed under "Needs your attention", including today's
  // unmarked attendance.
  const pendingTotal = d.pendingLeave.length + d.pendingExp.length
    + d.pendingCorrections.length + unmarkedToday;
  const visitTotals = countVisitsForMonth(d.monthVisits, d.month);

  const STATUS_TONE = {
    none: 'neutral', unpaid: 'danger',
    partially_paid: 'warn', fully_paid: 'success',
  } as const;
  const prevPayDate = new Date(
    d.previousMonth.getFullYear(), d.previousMonth.getMonth() + 1,
    d.settings.salary_payment_day,
  );
  const startOfToday = new Date(
    d.today.getFullYear(), d.today.getMonth(), d.today.getDate());
  const daysRemaining = Math.round(
    (prevPayDate.getTime() - startOfToday.getTime()) / 86_400_000);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Payroll month: ${formatMonth(d.month)}`} />

      <div className="stat-grid">
        <StatCard label="Active employees" value={d.employees.length} />
        <StatCard label="Present today" value={d.presentToday} tone="good" />
        <StatCard label="On leave today" value={d.onLeaveToday} />
        <StatCard
          label="Pending approvals"
          value={d.pendingLeave.length + d.pendingExp.length}
          tone={d.pendingLeave.length + d.pendingExp.length > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="two-col">
        <Card
          title={
            <span className="attention-title">
              Needs your attention
              {pendingTotal > 0 && (
                <span className="alert-bell" role="status"
                  aria-label={`${pendingTotal} item${pendingTotal === 1 ? '' : 's'} pending`}>
                  <span aria-hidden="true">🔔</span>
                  <span className="alert-count">{pendingTotal}</span>
                </span>
              )}
            </span>
          }
        >
          <ul className="plain-list">
            <li>
              <Link to="/admin/leave">Leave requests awaiting approval</Link>
              <strong className={d.pendingLeave.length > 0 ? 'count-pending' : undefined}>
                {d.pendingLeave.length}
              </strong>
            </li>
            <li>
              <Link to="/admin/expenses">Expense claims awaiting approval</Link>
              <strong className={d.pendingExp.length > 0 ? 'count-pending' : undefined}>
                {d.pendingExp.length}
              </strong>
            </li>
            <li>
              <Link to="/admin/leave">Attendance corrections awaiting approval</Link>
              <strong className={d.pendingCorrections.length > 0 ? 'count-pending' : undefined}>
                {d.pendingCorrections.length}
              </strong>
            </li>
            <li>
              <Link to={`/admin/attendance?date=${todayIso}&exceptions=1`}>
                Attendance not marked today
              </Link>
              <strong className={unmarkedToday > 0 ? 'count-pending' : undefined}>
                {unmarkedToday}
              </strong>
            </li>
          </ul>
        </Card>

        <Card title="Company money">
          <ul className="plain-list">
            <li>
              <span>Outstanding company advances</span>
              <strong>{formatCurrency(d.outstandingAdvance)}</strong>
            </li>
            <li>
              <Link to="/admin/company-advance">Record company advance</Link>
            </li>
          </ul>
        </Card>
      </div>

      <div className="two-col">
        <Card title="Outdoor visits">
          <ul className="plain-list">
            <li>
              <Link to="/admin/outdoor-visits">Visits awaiting approval</Link>
              <strong className={d.pendingVisits.length > 0 ? 'count-pending' : undefined}>
                {d.pendingVisits.length}
              </strong>
            </li>
            <li>
              <span>Approved day visits this month</span>
              <strong>{visitTotals.dayVisitDays}</strong>
            </li>
            <li>
              <span>Approved overnight visits this month</span>
              <strong>{visitTotals.overnightVisits}</strong>
            </li>
          </ul>
        </Card>

        <Card title={`Payroll snapshot — ${formatMonth(d.month)}`}>
          <div className="stat-grid">
            <StatCard label="Employees processed" value={`${processed} / ${d.employees.length}`} />
            <StatCard label="Net salary payable" value={formatCurrency(netPayable)} />
          </div>
          <div className="row-end gap">
            <Link className="btn btn-secondary btn-sm" to="/admin/payroll-summary">Summary</Link>
            <Link className="btn btn-primary btn-sm" to="/admin/payroll">Run payroll</Link>
          </div>
        </Card>
      </div>

      <Card
        title={`${formatMonth(d.previousMonth)} payroll settlement`}
        actions={<Badge tone={STATUS_TONE[companyStatus]}>
          {STATUS_TEXT[companyStatus]}
        </Badge>}
      >
        <div className="stat-grid">
          <StatCard label="Net payable" value={formatCurrency(prevTotal)} />
          <StatCard label="Paid" value={formatCurrency(paidAmount)}
            tone={paidAmount > 0 ? 'good' : 'default'} />
          <StatCard label="Outstanding" value={formatCurrency(outstandingAmount)}
            tone={outstandingAmount > 0 ? 'warn' : 'default'} />
        </div>
        <ul className="plain-list">
          <li>
            <span>Payroll date</span>
            <strong>{formatDate(prevPayDate)}</strong>
          </li>
          {companyStatus !== 'fully_paid' && companyStatus !== 'none' && (
            <li>
              <span>{daysRemaining >= 0 ? 'Days remaining' : 'Overdue by'}</span>
              <strong className={daysRemaining <= 2 ? 'count-pending' : undefined}>
                {Math.abs(daysRemaining)} day{Math.abs(daysRemaining) === 1 ? '' : 's'}
              </strong>
            </li>
          )}
          <li>
            <span>Employees paid</span>
            <strong>{paidRows.length} / {prev.length}</strong>
          </li>
        </ul>
        {paidRows.length > 0 && (
          <details className="payment-details">
            <summary>Payment references ({paidRows.length})</summary>
            <ul className="plain-list">
              {paidRows.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.employees?.first_name} {p.employees?.last_name}
                    {p.payment_mode ? ` · ${p.payment_mode}` : ''}
                    {p.cheque_utr ? ` · ${p.cheque_utr}` : ''}
                  </span>
                  <strong>{formatDate(p.payment_date)}</strong>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </>
  );
}
