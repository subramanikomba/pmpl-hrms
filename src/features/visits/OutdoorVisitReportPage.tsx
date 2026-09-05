import { useMemo, useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { clientApi, employeesApi, outdoorVisitApi } from '@/lib/api';
import { isoDate, monthStart } from '@/lib/payroll';
import { countVisitsForMonth, to12Hour } from '@/lib/visits';
import { formatDate, monthInputValue, parseMonthInput } from '@/lib/format';
import { Card, StatCard } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select, TextInput } from '@/components/ui/Field';
import { VisitApprovalSection } from './VisitApprovalSection';
import type { OutdoorVisit, WithEmployee } from '@/types/db';

type Row = WithEmployee<OutdoorVisit>;

/**
 * Admin view of employee outdoor visits for a month, with the per-employee
 * totals that feed the Outdoor Day / Outdoor Overnight allowance rules.
 * Read-only: payroll remains where allowances are actually applied.
 */
export function OutdoorVisitReportPage() {
  const today = useMemo(() => new Date(), []);
  const [monthValue, setMonthValue] = useState(monthInputValue(today));
  const [employeeId, setEmployeeId] = useState('');

  const month = parseMonthInput(monthValue) ?? monthStart(today);

  const q = useQuery(async () => {
    const from = isoDate(monthStart(month));
    const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const [visits, employees, clients] = await Promise.all([
      outdoorVisitApi.listAll({
        from, to, employeeId: employeeId || undefined,
      }),
      employeesApi.listActive(),
      clientApi.listWithLocations(),
    ]);
    return {
      visits, employees,
      locations: clients.flatMap((c) => c.locations),
    };
  }, [monthValue, employeeId]);

  const visits = q.data?.visits ?? [];
  const employees = q.data?.employees ?? [];
  const locations = q.data?.locations ?? [];
  /** Client site name for a visit, when one was recorded. */
  const locationName = (id: string) =>
    locations.find((l) => l.id === id)?.name ?? '—';

  const columns: Column<Row>[] = [
    { key: 'emp', header: 'Employee',
      cell: (v) => (
        <>
          <strong>{v.employees?.employee_code}</strong>
          <div className="emp-name">
            {v.employees?.first_name} {v.employees?.last_name}
          </div>
        </>
      ) },
    { key: 'dates', header: 'Dates',
      cell: (v) => (
        <>
          {formatDate(v.start_date)}
          {v.start_date !== v.end_date && <> – {formatDate(v.end_date)}</>}
        </>
      ) },
    { key: 'type', header: 'Type',
      cell: (v) => v.visit_type === 'overnight'
        ? <Badge tone="info">Overnight</Badge>
        : <Badge tone="neutral-alt">Day visit</Badge> },
    { key: 'times', header: 'Times',
      cell: (v) => `${to12Hour(v.start_time)} – ${to12Hour(v.end_time)}` },
    { key: 'count', header: 'Count', align: 'right',
      cell: (v) => v.visit_type === 'overnight' ? v.nights : v.day_count },
    { key: 'status', header: 'Status',
      cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'where', header: 'Site / location',
      cell: (v) => (
        <>
          {v.location}
          {v.client_location_id && (
            <div className="muted small">
              {locationName(v.client_location_id)}
            </div>
          )}
        </>
      ) },
    { key: 'purpose', header: 'Purpose',
      cell: (v) => v.purpose ?? <span className="muted">—</span> },
  ];

  const overall = countVisitsForMonth(visits, month);

  return (
    <>
      <PageHeader
        title="Outdoor visits"
        subtitle="Approve visits, and review the counts used for outdoor allowance rules"
      />

      <VisitApprovalSection />

      <Card>
        <div className="form-grid-2">
          <TextInput label="Month" type="month" value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)} />
          <Select label="Employee" value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Approved visits" value={overall.visits} />
        <StatCard label="Day-visit days" value={overall.dayVisitDays} />
        <StatCard label="Overnight visits" value={overall.overnightVisits}
          tone="good" />
      </div>

      {q.loading ? <Spinner label="Loading visits…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : (
          <>
            <Card title="Visits">
              <DataTable columns={columns} rows={visits} rowKey={(v) => v.id}
                empty="No outdoor visits recorded for this period." />
            </Card>
          </>
        )}
    </>
  );
}
