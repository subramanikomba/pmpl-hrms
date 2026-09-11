import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { clientApi, outdoorVisitApi } from '@/lib/api';
import { employeeMayMark, isoDate, monthStart } from '@/lib/payroll';
import { countVisitsForMonth, to12Hour, validateVisit, type VisitType } from '@/lib/visits';
import { formatDate } from '@/lib/format';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select, TextInput } from '@/components/ui/Field';
import { ClientLocationSelect } from '@/components/ui/ClientLocationSelect';
import { TimeInput } from '@/components/ui/TimeInput';
import { StatusBadge } from '@/components/ui/Badge';
import type { OutdoorVisit } from '@/types/db';

/**
 * Employee record of outdoor / site visits.
 *
 * This is NOT an expense claim — no amounts, no reimbursement, no approval.
 * It records when the employee was on site and whether a night was spent, so
 * Admin can apply the configured Outdoor Day / Outdoor Overnight rules with
 * real quantities at payroll time.
 *
 * Editing follows the same window as attendance: once the period closes, past
 * visits are frozen so a finalised bonus cannot change underneath it.
 */
export function OutdoorVisitsPage() {
  const { employee } = useAuth();
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const employeeId = employee?.id ?? '';

  const [startDate, setStartDate] = useState(isoDate(today));
  const [endDate, setEndDate] = useState(isoDate(today));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('day');
  const [clientId, setClientId] = useState('');
  const [clientLocationId, setClientLocationId] = useState('');
  const [location, setLocation] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);
  // Validation messages appear only once the employee tries to submit —
  // an untouched form should not look like it is already in error.
  const [attempted, setAttempted] = useState(false);

  const q = useQuery(async () => {
    const [visits, clients] = await Promise.all([
      employeeId ? outdoorVisitApi.listFor(employeeId) : Promise.resolve([]),
      clientApi.list(),
    ]);
    return { visits, clients };
  }, [employeeId]);

  if (!employee) return null;

  const visits = q.data?.visits ?? [];
  const clients = q.data?.clients ?? [];
  // Only approved visits are confirmed for bonus purposes.
  const totals = countVisitsForMonth(visits, monthStart(today));

  // Live validation, using exactly the rules payroll and Admin will apply.
  const draft = {
    startDate, endDate, startTime, endTime, visitType, location,
  };
  const check = validateVisit(draft, today);

  function reset() {
    setStartDate(isoDate(today)); setEndDate(isoDate(today));
    setStartTime(''); setEndTime(''); setVisitType('day');
    setClientId(''); setClientLocationId(''); setLocation(''); setPurpose('');
  }

  async function save() {
    setAttempted(true);
    // The same pure rules the database constraints enforce.
    if (!check.ok) { toast.error(check.error); return; }
    // Client-side twin of the ov_own_insert policy.
    if (!employeeMayMark(new Date(startDate), today)) {
      toast.error('That period is closed for editing and can no longer be changed.');
      return;
    }
    setSaving(true);
    try {
      await outdoorVisitApi.create({
        employee_id: employeeId,
        start_date: check.value.startDate,
        end_date: check.value.endDate,
        start_time: check.value.startTime,
        end_time: check.value.endTime,
        visit_type: check.value.visitType,
        client_id: clientId || null,
        client_location_id: clientLocationId || null,
        location: location.trim(),
        purpose: purpose.trim() || null,
      });
      toast.success('Visit submitted for Admin approval.');
      setAttempted(false);
      reset();
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the visit');
    } finally { setSaving(false); }
  }

  async function remove(v: OutdoorVisit) {
    if (!window.confirm(`Remove the visit starting ${formatDate(v.start_date)}?`)) return;
    try {
      await outdoorVisitApi.remove(v.id);
      toast.info('Visit removed.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the visit');
    }
  }

  const columns: Column<OutdoorVisit>[] = [
    { key: 'dates', header: 'Dates',
      cell: (v) => (
        <>
          {formatDate(v.start_date)}
          {v.start_date !== v.end_date && <> – {formatDate(v.end_date)}</>}
          <div className="muted small">
            {to12Hour(v.start_time)} to {to12Hour(v.end_time)}
          </div>
        </>
      ) },
    { key: 'type', header: 'Type',
      cell: (v) => v.visit_type === 'overnight'
        ? <Badge tone="info">
            {v.day_count} Day{v.day_count === 1 ? '' : 's'} /{' '}
            {v.nights} Night{v.nights === 1 ? '' : 's'}
          </Badge>
        : <Badge tone="neutral-alt">
            {v.day_count} Day{v.day_count === 1 ? '' : 's'}
          </Badge> },
    { key: 'status', header: 'Status',
      cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'where', header: 'Client / site',
      cell: (v) => (
        <>
          {clients.find((c) => c.id === v.client_id)?.name ?? '—'}
          {v.location && <div className="muted small">{v.location}</div>}
        </>
      ) },
    { key: 'purpose', header: 'Purpose',
      cell: (v) => v.purpose ?? <span className="muted">—</span> },
    { key: 'act', header: '', align: 'right',
      // Once Admin has decided, the record is no longer the employee's to change.
      cell: (v) => v.status === 'pending'
        && employeeMayMark(new Date(v.start_date), today)
        ? <Button size="sm" variant="ghost" onClick={() => void remove(v)}>Remove</Button>
        : <span className="muted small">Locked</span> },
  ];

  return (
    <>
      <PageHeader
        title="Outdoor visits"
        subtitle="Record site visits and night stays. Expenses are claimed separately."
      />

      <div className="stat-grid">
        <StatCard label="Approved visits" value={totals.visits} />
        <StatCard label="Day-visit days" value={totals.dayVisitDays} />
        <StatCard label="Nights away" value={totals.overnightNights}
          tone="good" />
      </div>

      <Card title="Record a visit">
        {/* Radios rather than a dropdown: both choices and what each means
            are visible at once, which matters because the choice decides
            which allowance rate applies. */}
        <div className="field">
          <span className="field-label">Visit type</span>
          <div className="radio-group">
            <label className={`radio-card ${visitType === 'day' ? 'is-active' : ''}`}>
              <input type="radio" name="visit-type" value="day"
                checked={visitType === 'day'}
                onChange={() => setVisitType('day')} />
              <span>
                <strong>Outdoor Day Visit</strong>
                <span className="radio-note">
                  You come back the same day. Paid per day.
                </span>
              </span>
            </label>
            <label className={`radio-card ${visitType === 'overnight' ? 'is-active' : ''}`}>
              <input type="radio" name="visit-type" value="overnight"
                checked={visitType === 'overnight'}
                onChange={() => setVisitType('overnight')} />
              <span>
                <strong>Outdoor Overnight Visit</strong>
                <span className="radio-note">
                  You stay away overnight. Paid per night.
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="form-grid-2">
          <TextInput label="Start date *" type="date" value={startDate}
            max={isoDate(today)}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate && endDate < e.target.value) setEndDate(e.target.value);
            }} />
          <TextInput label="End date" type="date" value={endDate}
            min={startDate} max={isoDate(today)}
            onChange={(e) => setEndDate(e.target.value)}
            hint="Leave blank if you returned the same day" />
        </div>
        <div className="form-grid-2">
          <TimeInput label="Start time *" value={startTime} onChange={setStartTime} />
          <TimeInput label="End time *" value={endTime} onChange={setEndTime} />
        </div>
        <TextInput label="Location *" value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Site or place visited" />
        <Select label="Client (optional)" value={clientId}
          onChange={(e) => setClientId(e.target.value)}>
          <option value="">— None —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <ClientLocationSelect clientId={clientId} value={clientLocationId}
          onChange={setClientLocationId}
          label="Client site (optional)" />
        <TextInput label="Purpose / remarks (optional)" value={purpose}
          onChange={(e) => setPurpose(e.target.value)} />

        <p className="muted small">* Required</p>

        {check.ok ? (
          <p className="callout-ok">
            <strong>
              {check.value.dayCount} Day{check.value.dayCount === 1 ? '' : 's'}
              {check.value.visitType === 'overnight'
                && ` / ${check.value.nights} Night${check.value.nights === 1 ? '' : 's'}`}
            </strong>
            {' — '}
            {formatDate(check.value.startDate)}, {to12Hour(check.value.startTime)}
            {' to '}
            {formatDate(check.value.endDate)}, {to12Hour(check.value.endTime)}.
            <br />
            {check.value.visitType === 'overnight'
              ? `You will be paid for ${check.value.nights} night`
                + `${check.value.nights === 1 ? '' : 's'} away.`
              : `You will be paid for ${check.value.dayCount} outdoor day`
                + `${check.value.dayCount === 1 ? '' : 's'}.`}
          </p>
        ) : attempted ? (
          <p className="callout-warn">{check.error}</p>
        ) : null}

        <Button variant="primary" disabled={saving}
          onClick={() => void save()}>
          Submit for approval
        </Button>
      </Card>

      <Card title="My visits">
        {q.loading ? <Spinner label="Loading your visits…" />
          : q.error ? <p className="error-text">{q.error}</p>
          : <DataTable columns={columns} rows={visits} rowKey={(v) => v.id}
              empty="No outdoor visits recorded yet." />}
      </Card>
    </>
  );
}
