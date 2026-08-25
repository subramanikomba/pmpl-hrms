import { useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { employeesApi, salaryApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { isoDate } from '@/lib/payroll';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Checkbox, TextInput } from '@/components/ui/Field';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { Employee } from '@/types/db';

interface NewEmployeeForm {
  first_name: string; last_name: string; username: string;
  email: string; password: string; designation: string;
  pan: string; is_admin: boolean;
}
const EMPTY_FORM: NewEmployeeForm = {
  first_name: '', last_name: '', username: '', email: '',
  password: '', designation: '', pan: '', is_admin: false,
};

export function EmployeesPage() {
  const toast = useToast();
  const q = useQuery(() => employeesApi.list(), []);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<NewEmployeeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [salaryFor, setSalaryFor] = useState<Employee | null>(null);

  if (q.loading) return <Spinner label="Loading employees…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  const employees = q.data ?? [];

  const set = <K extends keyof NewEmployeeForm>(k: K, v: NewEmployeeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function createEmployee() {
    if (!form.first_name || !form.last_name || !form.username || !form.email) {
      toast.error('First name, last name, username and email are required.');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await employeesApi.create({
        email: form.email.trim(), password: form.password,
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        username: form.username.trim(), designation: form.designation.trim(),
        pan: form.pan.trim().toUpperCase(), is_admin: form.is_admin,
      });
      toast.success('Employee created.');
      setAddOpen(false); setForm(EMPTY_FORM); q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create employee');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(emp: Employee) {
    try {
      await employeesApi.setStatus(emp.id, emp.status === 'active' ? 'inactive' : 'active');
      toast.success('Employee status updated.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update status');
    }
  }

  const columns: Column<Employee>[] = [
    { key: 'code', header: 'Code', cell: (e) => e.employee_code, width: '90px' },
    {
      key: 'name', header: 'Name',
      cell: (e) => (
        <>
          {e.first_name} {e.last_name}
          {e.is_admin && <> <Badge tone="danger">Admin</Badge></>}
        </>
      ),
    },
    { key: 'designation', header: 'Designation', cell: (e) => e.designation || '—' },
    { key: 'email', header: 'Email', cell: (e) => e.contact_email || '—' },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (e) => (
        <div className="row-end gap-sm">
          <Button size="sm" onClick={() => setSalaryFor(e)}>Salary</Button>
          <Button size="sm" variant="ghost" onClick={() => void toggleStatus(e)}>
            {e.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Employee management"
        subtitle="Employee records and salary structures"
        actions={<Button variant="primary" onClick={() => setAddOpen(true)}>Add employee</Button>}
      />

      <Card>
        <DataTable columns={columns} rows={employees} rowKey={(e) => e.id}
          empty="No employees yet." />
      </Card>

      <Modal open={addOpen} title="Add employee" onClose={() => setAddOpen(false)}>
        <div className="form-grid-2">
          <TextInput label="First name" value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)} />
          <TextInput label="Last name" value={form.last_name}
            onChange={(e) => set('last_name', e.target.value)} />
        </div>
        <div className="form-grid-2">
          <TextInput label="Username" value={form.username}
            onChange={(e) => set('username', e.target.value)} />
          <TextInput label="Designation" value={form.designation}
            onChange={(e) => set('designation', e.target.value)} />
        </div>
        <TextInput label="Email (used to sign in)" type="email" value={form.email}
          onChange={(e) => set('email', e.target.value)} />
        <div className="form-grid-2">
          <TextInput label="Temporary password" type="password" value={form.password}
            onChange={(e) => set('password', e.target.value)}
            hint="Minimum 8 characters" />
          <TextInput label="PAN" value={form.pan} maxLength={10}
            onChange={(e) => set('pan', e.target.value)} />
        </div>
        <Checkbox label="This employee is an administrator" checked={form.is_admin}
          onChange={(e) => set('is_admin', e.target.checked)} />
        <div className="row-end gap">
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void createEmployee()}>
            {saving ? 'Creating…' : 'Create employee'}
          </Button>
        </div>
      </Modal>

      {salaryFor && (
        <SalaryStructureModal
          employee={salaryFor}
          onClose={() => setSalaryFor(null)}
        />
      )}
    </>
  );
}

/* ── Salary structure editor ───────────────────────────────────── */

const COMPONENTS = [
  ['basic', 'Basic'],
  ['hra', 'HRA'],
  ['special_allowance', 'Special allowance'],
  ['transport_allowance', 'Transport allowance'],
  ['medical_allowance', 'Medical allowance'],
  ['conveyance_other', 'Conveyance / other'],
] as const;

type ComponentKey = (typeof COMPONENTS)[number][0];
type Amounts = Record<ComponentKey, string>;

const ZERO: Amounts = {
  basic: '0', hra: '0', special_allowance: '0',
  transport_allowance: '0', medical_allowance: '0', conveyance_other: '0',
};

function SalaryStructureModal(
  { employee, onClose }: { employee: Employee; onClose: () => void },
) {
  const toast = useToast();
  const q = useQuery(() => salaryApi.listFor(employee.id), [employee.id]);
  const [effective, setEffective] = useState(isoDate(new Date()));
  const [amounts, setAmounts] = useState<Amounts>(ZERO);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed the form from the latest revision, once.
  if (!seeded && q.data && q.data.length > 0) {
    const latest = q.data[0];
    if (latest) {
      setAmounts({
        basic: String(latest.basic), hra: String(latest.hra),
        special_allowance: String(latest.special_allowance),
        transport_allowance: String(latest.transport_allowance),
        medical_allowance: String(latest.medical_allowance),
        conveyance_other: String(latest.conveyance_other),
      });
      setSeeded(true);
    }
  }

  const total = COMPONENTS.reduce((s, [k]) => s + (Number(amounts[k]) || 0), 0);

  async function save() {
    setSaving(true);
    try {
      await salaryApi.upsert({
        employee_id: employee.id,
        effective_from: effective,
        basic: Number(amounts.basic) || 0,
        hra: Number(amounts.hra) || 0,
        special_allowance: Number(amounts.special_allowance) || 0,
        transport_allowance: Number(amounts.transport_allowance) || 0,
        medical_allowance: Number(amounts.medical_allowance) || 0,
        conveyance_other: Number(amounts.conveyance_other) || 0,
      });
      toast.success('Salary structure saved.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save salary structure');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Salary — ${employee.first_name} ${employee.last_name}`}
      onClose={onClose}
    >
      <p className="muted">
        Revisions are effective-dated, so payroll for past months keeps using the
        structure that applied at the time.
      </p>

      <h3 className="section-title">New / updated revision</h3>
      <TextInput label="Effective from" type="date" value={effective}
        onChange={(e) => setEffective(e.target.value)} />
      <div className="form-grid-2">
        {COMPONENTS.map(([key, label]) => (
          <TextInput
            key={key} label={`${label} (₹)`} type="number" min="0" step="0.01"
            value={amounts[key]}
            onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
          />
        ))}
      </div>
      <p className="total-line">Monthly gross (full month): <strong>{formatCurrency(total)}</strong></p>
      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save revision'}
        </Button>
      </div>

      <h3 className="section-title">Revision history</h3>
      {q.loading ? <Spinner /> : (
        <DataTable
          columns={[
            { key: 'from', header: 'Effective from', cell: (s) => formatDate(s.effective_from) },
            ...COMPONENTS.map(([key, label]) => ({
              key, header: label, align: 'right' as const,
              cell: (s: { [K in ComponentKey]: number }) => formatCurrency(s[key]),
            })),
          ]}
          rows={q.data ?? []}
          rowKey={(s) => s.id}
          empty="No salary structure defined yet."
        />
      )}
    </Modal>
  );
}
