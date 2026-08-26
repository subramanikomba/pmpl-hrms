import { Link } from 'react-router-dom';
import { useQuery } from '@/lib/useQuery';
import {
  advanceApi, attendanceApi, employeesApi, expenseApi, leaveApi, payrollApi,
} from '@/lib/api';
import { isoDate, monthStart } from '@/lib/payroll';
import { formatCurrency, formatMonth } from '@/lib/format';
import { Card, StatCard } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';

export function AdminDashboardPage() {
  const q = useQuery(async () => {
    const today = new Date();
    const month = monthStart(today);
    const [employees, todayAtt, pendingLeave, pendingExp, payroll, advances, accounted] =
      await Promise.all([
        employeesApi.listActive(),
        attendanceApi.listForMonth(month),
        leaveApi.listAll('pending'),
        expenseApi.listAll({ status: 'pending' }),
        payrollApi.listForMonth(month),
        advanceApi.listAll(),
        expenseApi.listAll({ status: 'approved' }),
      ]);
    const todayStr = isoDate(today);
    return {
      employees,
      presentToday: todayAtt.filter((a) => a.date === todayStr && a.status === 'present').length,
      onLeaveToday: todayAtt.filter((a) => a.date === todayStr && a.status === 'paid_leave').length,
      pendingLeave, pendingExp, payroll, month,
      outstandingAdvance:
        advances.reduce((s, a) => s + Number(a.amount), 0)
        - accounted.reduce((s, e) => s + Number(e.accounted_amount ?? 0), 0),
    };
  }, []);

  if (q.loading) return <Spinner label="Loading dashboard…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (!q.data) return null;

  const d = q.data;
  const pendingTotal = d.pendingLeave.length + d.pendingExp.length;
  const netPayable = d.payroll.reduce((s, p) => s + Number(p.net_salary), 0);
  const processed = d.payroll.filter((p) => p.status !== 'draft').length;

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

      <Card title={`Payroll snapshot — ${formatMonth(d.month)}`}>
        <div className="stat-grid">
          <StatCard label="Processed" value={`${processed} / ${d.employees.length}`} />
          <StatCard label="Net salary payable" value={formatCurrency(netPayable)} />
        </div>
        <div className="row-end gap">
          <Link className="btn btn-secondary btn-sm" to="/admin/payroll-summary">Summary</Link>
          <Link className="btn btn-primary btn-sm" to="/admin/payroll">Run payroll</Link>
        </div>
      </Card>
    </>
  );
}
