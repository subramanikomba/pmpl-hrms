import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@/lib/useQuery';
import { outdoorVisitApi } from '@/lib/api';
import { monthStart } from '@/lib/payroll';
import { countVisitsForMonth } from '@/lib/visits';
import { formatMonth } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Compact outdoor visit summary for the employee dashboard.
 * Counts APPROVED visits only — a pending visit is not yet a confirmed one.
 */
export function EmployeeVisitSummaryCard({ employeeId }: { employeeId: string }) {
  const today = useMemo(() => new Date(), []);
  const month = useMemo(() => monthStart(today), [today]);

  const q = useQuery(
    () => employeeId ? outdoorVisitApi.listFor(employeeId) : Promise.resolve([]),
    [employeeId],
  );

  if (q.loading) return <Spinner label="Loading outdoor visits…" />;
  if (q.error || !q.data) return null;

  const totals = countVisitsForMonth(q.data, month);
  const pending = q.data.filter((v) => v.status === 'pending').length;

  return (
    <Card title={`Outdoor visits — ${formatMonth(month)}`}>
      <ul className="plain-list">
        <li><span>Day visits</span><strong>{totals.dayVisitDays}</strong></li>
        <li><span>Overnight visits</span><strong>{totals.overnightVisits}</strong></li>
        {pending > 0 && (
          <li>
            <span>Awaiting approval</span>
            <strong className="count-pending">{pending}</strong>
          </li>
        )}
      </ul>
      <Link className="btn btn-secondary btn-sm" to="/outdoor-visits">
        View outdoor visits
      </Link>
    </Card>
  );
}
