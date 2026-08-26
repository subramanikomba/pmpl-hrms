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
  first_name: string; last_name: string;
  email: string; password: string; designation: string;
  pan: string; phone: string; is_admin: boolean;
}
const EMPTY_FORM: NewEmployeeForm = {
  first_name: '', last_name: '', email: '',
  password: '', designation: '', pan: '', phone: '', is_admin: false,
};

export function EmployeesPage() {
  const toast = useToast();
  const q = useQuery(() => employeesApi.list(), []);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<NewEmployeeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [salaryFor, setSalaryFor] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);

  if (q.loading) return <Spinner label="Loading employees…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  const employees = q.data ?? [];

  const set = <K extends keyof NewEmployeeForm>(k: K, v: NewEmployeeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Only warn about losing work if something was actually entered.
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);

  async function createEmployee() {
    if (!form.first_name || !form.last_name || !form.email) {
      toast.error('First name, last name and email are required.');
      return;
    }
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    try {
      await employeesApi.create({
        email: form.email.trim(), password: form.password,
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        designation: form.designation.trim(), phone: form.phone.trim(),
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
          <Button size="sm" onClick={() => setEditing(e)}>Edit</Button>
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

      <Modal
        open={addOpen}
        title="Add employee"
        onClose={() => { setAddOpen(false); setForm(EMPTY_FORM); }}
        dismissOnBackdrop={false}
        confirmClose={dirty}
        confirmMessage="Discard this employee’s details?"
      >
        <div className="form-grid-2">
          <TextInput label="First name" value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)} />
          <TextInput label="Last name" value={form.last_name}
            onChange={(e) => set('last_name', e.target.value)} />
        </div>
        <div className="form-grid-2">
          <TextInput label="Phone (optional)" value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            hint="Contact information only" />
          <TextInput label="Designation" value={form.designation}
            onChange={(e) => set('designation', e.target.value)} />
        </div>
        <TextInput label="Email address" type="email" value={form.email}
          onChange={(e) => set('email', e.target.value)} />
        <div className="form-grid-2">
          <TextInput label="Temporary password" type="password" value={form.password}
            onChange={(e) => set('password', e.target.value)}
            hint="Minimum 6 characters" />
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

      {editing && (
        <EditEmployeeModal
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); q.reload(); }}
        />
      )}

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
      dismissOnBackdrop={false}
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

/* ── Edit employee profile ─────────────────────────────────────
 * Descriptive fields only. Payroll, attendance and salary history key off
 * the employee id, so renaming or correcting a detail here cannot alter any
 * historical calculation or transaction.
 */
function EditEmployeeModal(
  { employee, onClose, onSaved }:
  { employee: Employee; onClose: () => void; onSaved: () => void },
) {
  const toast = useToast();
  const [first, setFirst] = useState(employee.first_name);
  const [last, setLast] = useState(employee.last_name);
  const [phone, setPhone] = useState(employee.phone ?? '');
  // Email is the Supabase Auth login identity and is deliberately NOT state:
  // it cannot be edited here, only displayed.
  const [designation, setDesignation] = useState(employee.designation ?? '');
  const [pan, setPan] = useState(employee.pan ?? '');
  const [isAdmin, setIsAdmin] = useState(employee.is_admin);
  const [saving, setSaving] = useState(false);
  // Password is never read back from the server — admin sets a new one only.
  const [showPw, setShowPw] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const dirty =
    first !== employee.first_name || last !== employee.last_name
    || phone !== (employee.phone ?? '')

    || designation !== (employee.designation ?? '')
    || pan !== (employee.pan ?? '')
    || isAdmin !== employee.is_admin;

  async function resetPassword() {
    if (newPw.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setPwSaving(true);
    try {
      await employeesApi.resetPassword(employee.id, newPw);
      toast.success('Password updated.');
      setNewPw(''); setShowPw(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update password');
    } finally { setPwSaving(false); }
  }

  async function save() {
    if (!first.trim() || !last.trim()) {
      toast.error('First name and last name are required.');
      return;
    }
    setSaving(true);
    try {
      await employeesApi.update(employee.id, {
        first_name: first.trim(),
        last_name: last.trim(),
        phone: phone.trim() || null,
        designation: designation.trim() || null,
        pan: pan.trim().toUpperCase() || null,
        is_admin: isAdmin,
      });
      toast.success('Employee details updated.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update employee');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      title={`Edit — ${employee.employee_code}`}
      onClose={onClose}
      dismissOnBackdrop={false}
      confirmClose={dirty}
      confirmMessage="Discard your changes to this employee?"
    >
      <p className="muted small">
        Profile details only. Changing these does not affect attendance,
        payroll or previously generated salary slips.
      </p>
      <div className="form-grid-2">
        <TextInput label="First name" value={first}
          onChange={(e) => setFirst(e.target.value)} />
        <TextInput label="Last name" value={last}
          onChange={(e) => setLast(e.target.value)} />
      </div>
      <div className="form-grid-2">
        <TextInput label="Phone (optional)" value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Contact information only — not used to sign in" />
        <TextInput label="Designation" value={designation}
          onChange={(e) => setDesignation(e.target.value)} />
      </div>
      <div className="form-grid-2">
        <div className="field">
          <label className="field-label">Email address (login)</label>
          <p className="readonly-value">{employee.contact_email}</p>
          <p className="field-hint">
            This is the employee’s login identity and cannot be changed here.
            Use “Set new password” below if they need access restored.
          </p>
        </div>
        <TextInput label="PAN" value={pan} maxLength={10}
          onChange={(e) => setPan(e.target.value)} />
      </div>
      <Checkbox label="This employee is an administrator" checked={isAdmin}
        onChange={(e) => setIsAdmin(e.target.checked)} />

      <hr className="divider" />

      <div className="pw-section">
        <div className="pw-head">
          <span className="pw-title">Password</span>
          {!showPw && (
            <Button size="sm" onClick={() => setShowPw(true)}>Set new password</Button>
          )}
        </div>
        {showPw ? (
          <>
            <p className="muted small">
              The existing password cannot be viewed. Entering a new one replaces
              it immediately; nothing else about this employee changes.
            </p>
            <div className="pw-row">
              <TextInput
                label="New password" type="password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                hint="Minimum 6 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="row-end gap">
              <Button variant="ghost" size="sm"
                onClick={() => { setShowPw(false); setNewPw(''); }}>Cancel</Button>
              <Button variant="primary" size="sm"
                disabled={pwSaving || newPw.length < 6}
                onClick={() => void resetPassword()}>
                {pwSaving ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          </>
        ) : (
          <p className="muted small">
            Set a new password if the employee needs one reset. The current
            password is not shown.
          </p>
        )}
      </div>

      <hr className="divider" />

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !dirty}
          onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
}
