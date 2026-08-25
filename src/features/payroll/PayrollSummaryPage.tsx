import { useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { payrollApi } from '@/lib/api';
import { formatCurrency, formatMonth } from '@/lib/format';
import { round2 } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import { DataTable } from '@/components/ui/DataTable';

interface MonthRow {
  month: string; count: number; gross: number;
  pt: number; sa: number; other: number; net: number;
}
interface EmpRow {
  id: string; label: string; designation: string; months: number;
  gross: number; pt: number; sa: number; net: number;
}

export function PayrollSummaryPage() {
  const thisYear = new Date().getFullYear();
  // Indian FY starts in April.
  const defaultFy = new Date().getMonth() >= 3 ? thisYear : thisYear - 1;
  const [fy, setFy] = useState(defaultFy);

  const q = useQuery(() => payrollApi.listForYear(fy), [fy]);
  const rows = q.data ?? [];

  const byMonth = new Map<string, MonthRow>();
  const byEmp = new Map<string, EmpRow>();

  for (const r of rows) {
    const m = byMonth.get(r.payroll_month) ?? {
      month: r.payroll_month, count: 0, gross: 0, pt: 0, sa: 0, other: 0, net: 0,
    };
    m.count += 1;
    m.gross += Number(r.gross_salary);
    m.pt += Number(r.professional_tax);
    m.sa += Number(r.salary_advance_recovered);
    m.other += Number(r.other_deductions);
    m.net += Number(r.net_salary);
    byMonth.set(r.payroll_month, m);

    const label = r.employees
      ? `${r.employees.employee_code} — ${r.employees.first_name} ${r.employees.last_name}`
      : 'Unknown';
    const e = byEmp.get(r.employee_id) ?? {
      id: r.employee_id, label, designation: r.employees?.designation ?? '—',
      months: 0, gross: 0, pt: 0, sa: 0, net: 0,
    };
    e.months += 1;
    e.gross += Number(r.gross_salary);
    e.pt += Number(r.professional_tax);
    e.sa += Number(r.salary_advance_recovered);
    e.net += Number(r.net_salary);
    byEmp.set(r.employee_id, e);
  }

  const monthRows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const empRows = [...byEmp.values()].sort((a, b) => a.label.localeCompare(b.label));

  const totals = monthRows.reduce((t, m) => ({
    gross: round2(t.gross + m.gross), pt: round2(t.pt + m.pt),
    sa: round2(t.sa + m.sa), other: round2(t.other + m.other),
    net: round2(t.net + m.net),
  }), { gross: 0, pt: 0, sa: 0, other: 0, net: 0 });

  const years = Array.from({ length: 5 }, (_, i) => defaultFy - i);

  return (
    <>
      <PageHeader title="Payroll summary" subtitle="Monthly totals and annual employee summary" />

      <Card>
        <Select label="Financial year" value={String(fy)}
          onChange={(e) => setFy(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>
          ))}
        </Select>
      </Card>

      {q.loading ? <Spinner label="Loading payroll summary…" />
        : q.error ? <Card><p className="error-text">{q.error}</p></Card>
        : rows.length === 0
          ? <Card><p className="muted">No payroll records for FY {fy}–{String(fy + 1).slice(2)}.</p></Card>
          : (
            <>
              <Card title={`Monthly summary — FY ${fy}–${String(fy + 1).slice(2)}`}>
                <DataTable
                  columns={[
                    { key: 'month', header: 'Month', cell: (m: MonthRow) => formatMonth(m.month) },
                    { key: 'count', header: 'Employees', align: 'right', cell: (m: MonthRow) => m.count },
                    { key: 'gross', header: 'Gross', align: 'right', cell: (m: MonthRow) => formatCurrency(m.gross) },
                    { key: 'pt', header: 'Prof. tax', align: 'right', cell: (m: MonthRow) => formatCurrency(m.pt) },
                    { key: 'sa', header: 'Adv. recovered', align: 'right', cell: (m: MonthRow) => formatCurrency(m.sa) },
                    { key: 'other', header: 'Other ded.', align: 'right', cell: (m: MonthRow) => formatCurrency(m.other) },
                    { key: 'net', header: 'Net payable', align: 'right',
                      cell: (m: MonthRow) => <strong>{formatCurrency(m.net)}</strong> },
                  ]}
                  rows={monthRows}
                  rowKey={(m) => m.month}
                  footer={
                    <tr className="totals-row">
                      <td colSpan={2}>Annual total</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(totals.gross)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(totals.pt)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(totals.sa)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(totals.other)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(totals.net)}</td>
                    </tr>
                  }
                />
              </Card>

              <Card title="Employee-wise annual summary">
                <DataTable
                  columns={[
                    { key: 'emp', header: 'Employee', cell: (e: EmpRow) => e.label },
                    { key: 'desig', header: 'Designation', cell: (e: EmpRow) => e.designation },
                    { key: 'months', header: 'Months', align: 'right', cell: (e: EmpRow) => e.months },
                    { key: 'gross', header: 'Gross', align: 'right', cell: (e: EmpRow) => formatCurrency(e.gross) },
                    { key: 'pt', header: 'Prof. tax', align: 'right', cell: (e: EmpRow) => formatCurrency(e.pt) },
                    { key: 'sa', header: 'Adv. recovered', align: 'right', cell: (e: EmpRow) => formatCurrency(e.sa) },
                    { key: 'net', header: 'Net paid', align: 'right',
                      cell: (e: EmpRow) => <strong>{formatCurrency(e.net)}</strong> },
                  ]}
                  rows={empRows}
                  rowKey={(e) => e.id}
                />
              </Card>
            </>
          )}
    </>
  );
}
