import { useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { clientApi, holidayApi, rulesApi, settingsApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { CompaniesPanel } from './CompaniesPanel';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextArea, TextInput } from '@/components/ui/Field';
import { DataTable } from '@/components/ui/DataTable';
import type { CompanySettings } from '@/types/db';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function describeWorkingDays(days: readonly number[]): string {
  if (days.length === 0) return 'none selected';
  const on = [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]);
  const off = DAY_NAMES.filter((_, i) => !days.includes(i));
  return `${on.join(', ')}${off.length ? ` · weekly off: ${off.join(', ')}` : ''}`;
}

export function SettingsPage() {
  const toast = useToast();
  const q = useQuery(async () => {
    const [settings, holidays, rules, clients] = await Promise.all([
      settingsApi.get(), holidayApi.list(), rulesApi.list(), clientApi.list(),
    ]);
    return { settings, holidays, rules, clients };
  }, []);

  const [form, setForm] = useState<Partial<CompanySettings> | null>(null);
  const [saving, setSaving] = useState(false);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  if (q.loading) return <Spinner label="Loading settings…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (!q.data) return null;

  const s = { ...q.data.settings, ...form };
  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function saveSettings() {
    if (!q.data) return;
    setSaving(true);
    try {
      await settingsApi.update(q.data.settings.id, {
        company_name: s.company_name, address: s.address, cin: s.cin,
        gst_number: s.gst_number, pt_monthly: Number(s.pt_monthly),
        pt_february: Number(s.pt_february),
        salary_payment_day: Number(s.salary_payment_day),
        working_days: s.working_days ?? [1, 2, 3, 4, 5, 6],
      });
      toast.success('Company settings saved.');
      setForm(null); q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save settings');
    } finally { setSaving(false); }
  }

  async function addHoliday() {
    if (!holidayDate || !holidayName.trim()) {
      toast.error('Enter both a date and a name.'); return;
    }
    try {
      await holidayApi.add(holidayDate, holidayName.trim());
      toast.success('Holiday added.');
      setHolidayDate(''); setHolidayName(''); q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add holiday');
    }
  }


  return (
    <>
      <PageHeader title="Payroll settings"
        subtitle="Company details, holidays, allowance rules and clients" />

      <Card title="Company information" className="settings-card">
        <TextInput label="Company name" value={s.company_name}
          onChange={(e) => set('company_name', e.target.value)} />
        <TextArea label="Registered address" value={s.address ?? ''}
          onChange={(e) => set('address', e.target.value)} />
        <div className="form-grid-2">
          <TextInput label="CIN" value={s.cin ?? ''} onChange={(e) => set('cin', e.target.value)} />
          <TextInput label="GST number" value={s.gst_number ?? ''}
            onChange={(e) => set('gst_number', e.target.value)} />
        </div>
        <div className="form-grid-2">
          <TextInput label="Professional tax — monthly (₹)" type="number"
            value={String(s.pt_monthly)} onChange={(e) => set('pt_monthly', Number(e.target.value))} />
          <TextInput label="Professional tax — February (₹)" type="number"
            value={String(s.pt_february)} onChange={(e) => set('pt_february', Number(e.target.value))} />
        </div>
        <TextInput label="Salary payment day (of the following month)" type="number"
          min="1" max="28" value={String(s.salary_payment_day)}
          onChange={(e) => set('salary_payment_day', Number(e.target.value))}
          hint="Payroll for a month locks after this day passes." />
        <Button variant="primary" disabled={saving} onClick={() => void saveSettings()}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </Card>

      <Card title="Working days" className="settings-card">
        <p className="muted small">
          Days marked as working days count for attendance. Days left unticked
          are weekly offs and are treated as paid days in payroll.
        </p>
        <div className="weekday-row">
          {DAY_NAMES.map((label, dow) => {
            const on = (s.working_days ?? [1, 2, 3, 4, 5, 6]).includes(dow);
            return (
              <label key={dow} className={`weekday ${on ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const cur = new Set(s.working_days ?? [1, 2, 3, 4, 5, 6]);
                    if (e.target.checked) cur.add(dow); else cur.delete(dow);
                    set('working_days', [...cur].sort((a, b) => a - b));
                  }}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
        <p className="field-hint">
          Currently working: {describeWorkingDays(s.working_days ?? [1, 2, 3, 4, 5, 6])}
        </p>
        <Button variant="primary" disabled={saving} onClick={() => void saveSettings()}>
          {saving ? 'Saving…' : 'Save working days'}
        </Button>
      </Card>

      <Card title="Allowance rules" className="settings-card">
          <p className="muted">
            Configurable percentages used when calculating allowances.
          </p>
          <DataTable
            columns={[
              { key: 'desc', header: 'Rule', cell: (r) => r.description },
              { key: 'rate', header: 'Rate (%)', align: 'right',
                cell: (r) => (
                  <input
                    className="cell-input" type="number" step="0.5" defaultValue={r.rate_percent}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== r.rate_percent) {
                        void rulesApi.update(r.id, { rate_percent: v })
                          .then(() => toast.success('Rule updated.'))
                          .catch(() => toast.error('Could not update rule.'));
                      }
                    }}
                  />
                ) },
              { key: 'active', header: 'Active', align: 'center',
                cell: (r) => (
                  <input type="checkbox" defaultChecked={r.is_active}
                    onChange={(e) => {
                      void rulesApi.update(r.id, { is_active: e.target.checked })
                        .catch(() => toast.error('Could not update rule.'));
                    }} />
                ) },
            ]}
            rows={q.data.rules}
            rowKey={(r) => r.id}
          />
      </Card>

      <Card title="Company holidays" className="settings-card compact-section">
          <p className="muted small">Holidays count as paid days in payroll.</p>
          <div className="scroll-y">
            <DataTable
              columns={[
                { key: 'date', header: 'Date', cell: (h) => formatDate(h.holiday_date) },
                { key: 'name', header: 'Holiday', cell: (h) => h.name },
                { key: 'act', header: '', align: 'right',
                  cell: (h) => (
                    <Button size="sm" variant="ghost" onClick={() => {
                      void holidayApi.remove(h.id)
                        .then(() => { toast.info('Holiday removed.'); q.reload(); })
                        .catch(() => toast.error('Could not remove holiday.'));
                    }}>Remove</Button>
                  ) },
              ]}
              rows={q.data.holidays}
              rowKey={(h) => h.id}
              empty="No company holidays configured."
            />
          </div>
          <div className="add-row">
            <TextInput label="Date" type="date" value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)} />
            <TextInput label="Holiday name" value={holidayName}
              onChange={(e) => setHolidayName(e.target.value)}
              placeholder="e.g. Diwali"
              onKeyDown={(e) => { if (e.key === 'Enter') void addHoliday(); }} />
            <Button variant="primary" onClick={() => void addHoliday()}>Add</Button>
          </div>
      </Card>

      <CompaniesPanel />
    </>
  );
}
