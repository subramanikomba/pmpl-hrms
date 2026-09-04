import { useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { outdoorVisitApi } from '@/lib/api';
import { to12Hour, validateVisit, type VisitType } from '@/lib/visits';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Select, TextInput } from '@/components/ui/Field';
import { TimeInput } from '@/components/ui/TimeInput';
import type { OutdoorVisit, WithEmployee } from '@/types/db';

type Row = WithEmployee<OutdoorVisit>;

/** "1 Overnight Visit" / "3-Day Outdoor Visit" — readable without opening it. */
export function visitHeadline(v: Pick<OutdoorVisit, 'visit_type' | 'day_count'>): string {
  return v.visit_type === 'overnight'
    ? '1 Overnight Visit'
    : `${v.day_count}-Day Outdoor Visit`;
}

/**
 * Admin approval of outdoor visits.
 *
 * The category decides which bonus rate applies, so Admin must confirm it
 * explicitly rather than approving in one click. Choosing "No, change
 * details" opens the record for correction instead of approving it.
 */
export function VisitApprovalSection() {
  const { employee } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery(() => outdoorVisitApi.listPending(), []);
  const rows = q.data ?? [];

  async function decide(v: Row, approve: boolean) {
    if (!employee) return;
    setBusyId(v.id);
    try {
      await outdoorVisitApi.decide(
        v.id, approve ? 'approved' : 'rejected', employee.id, v.visit_type);
      toast.success(approve
        ? `Approved as ${v.visit_type === 'overnight'
          ? 'an Outdoor Overnight Visit' : 'an Outdoor Day Visit'}.`
        : 'Visit rejected.');
      setConfirming(null);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not decide the visit');
    } finally { setBusyId(null); }
  }

  if (q.loading) return <Spinner label="Loading outdoor visits…" />;
  if (q.error) return <Card><p className="error-text">{q.error}</p></Card>;
  if (rows.length === 0) return null;

  return (
    <>
      <Card title="Outdoor visit approvals">
        <p className="muted small">
          The visit type decides the bonus rate, so confirm it before approving.
          Approving records the confirmed type and makes it count for payroll.
          It does not change attendance.
        </p>
        {rows.map((v) => (
          <div key={v.id} className="approval-row">
            <div className="approval-head">
              <div>
                <strong>{v.employees?.first_name} {v.employees?.last_name}</strong>{' '}
                <span className="muted">{v.employees?.employee_code}</span>
              </div>
              <Badge tone={v.visit_type === 'overnight' ? 'info' : 'neutral-alt'}>
                {visitHeadline(v)} — approval required
              </Badge>
            </div>
            <p className="approval-dates">
              {formatDate(v.start_date)}, {to12Hour(v.start_time)}
              {' → '}
              {formatDate(v.end_date)}, {to12Hour(v.end_time)}
              <span className="muted"> · {v.location}</span>
            </p>
            {v.purpose && <p className="muted">{v.purpose}</p>}
            <div className="row-end gap">
              <Button variant="ghost" disabled={busyId === v.id}
                onClick={() => void decide(v, false)}>Reject</Button>
              <Button variant="success" disabled={busyId === v.id}
                onClick={() => setConfirming(v)}>Approve</Button>
            </div>
          </div>
        ))}
      </Card>

      {confirming && (
        <Modal open size="sm" title="Confirm visit type"
          onClose={() => setConfirming(null)} dismissOnBackdrop={false}>
          <p>Employee has submitted:</p>
          <p className="today-status">
            <strong>
              {confirming.visit_type === 'overnight'
                ? 'Outdoor Overnight Visit' : 'Outdoor Day Visit'}
            </strong>
          </p>
          <ul className="plain-list">
            <li><span>Employee</span><strong>
              {confirming.employees?.first_name} {confirming.employees?.last_name}
            </strong></li>
            <li><span>Start</span><strong>
              {formatDate(confirming.start_date)}, {to12Hour(confirming.start_time)}
            </strong></li>
            <li><span>End</span><strong>
              {formatDate(confirming.end_date)}, {to12Hour(confirming.end_time)}
            </strong></li>
            <li><span>Location</span><strong>{confirming.location}</strong></li>
            <li><span>Counts as</span><strong>
              {confirming.visit_type === 'overnight'
                ? '1 overnight visit'
                : `${confirming.day_count} outdoor day visit${
                  confirming.day_count === 1 ? '' : 's'}`}
            </strong></li>
          </ul>
          <p>
            Approve this visit as {confirming.visit_type === 'overnight'
              ? 'an Outdoor Overnight Visit' : 'an Outdoor Day Visit'}?
          </p>
          <div className="row-end gap">
            <Button variant="secondary"
              onClick={() => { setEditing(confirming); setConfirming(null); }}>
              No, change details
            </Button>
            <Button variant="success" disabled={busyId === confirming.id}
              onClick={() => void decide(confirming, true)}>
              Approve as {confirming.visit_type === 'overnight'
                ? 'Overnight Visit' : 'Day Visit'}
            </Button>
          </div>
        </Modal>
      )}

      {editing && (
        <AmendVisitModal
          visit={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); q.reload(); }}
        />
      )}
    </>
  );
}

/** Admin correction of a pending visit, using the same validation rules. */
function AmendVisitModal(
  { visit, onClose, onSaved }:
  { visit: Row; onClose: () => void; onSaved: () => void },
) {
  const toast = useToast();
  const [startDate, setStartDate] = useState(visit.start_date);
  const [endDate, setEndDate] = useState(visit.end_date);
  const [startTime, setStartTime] = useState(visit.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(visit.end_time.slice(0, 5));
  const [visitType, setVisitType] = useState<VisitType>(visit.visit_type);
  const [location, setLocation] = useState(visit.location);
  const [saving, setSaving] = useState(false);

  const check = validateVisit(
    { startDate, endDate, startTime, endTime, visitType, location });

  async function save() {
    if (!check.ok) { toast.error(check.error); return; }
    setSaving(true);
    try {
      await outdoorVisitApi.amend(visit.id, {
        start_date: check.value.startDate,
        end_date: check.value.endDate,
        start_time: check.value.startTime,
        end_time: check.value.endTime,
        visit_type: check.value.visitType,
        location: location.trim(),
      });
      toast.success('Visit details corrected. You can now approve it.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the visit');
    } finally { setSaving(false); }
  }

  return (
    <Modal open size="md" title="Correct visit details" onClose={onClose}
      dismissOnBackdrop={false}>
      <Select label="Visit type" value={visitType}
        onChange={(e) => setVisitType(e.target.value as VisitType)}>
        <option value="day">Outdoor Day Visit</option>
        <option value="overnight">Outdoor Overnight Visit</option>
      </Select>
      <div className="form-grid-2">
        <TextInput label="Start date" type="date" value={startDate}
          onChange={(e) => setStartDate(e.target.value)} />
        <TextInput label="End date" type="date" value={endDate}
          onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="form-grid-2">
        <TimeInput label="Start time" value={startTime} onChange={setStartTime} />
        <TimeInput label="End time" value={endTime} onChange={setEndTime} />
      </div>
      <TextInput label="Location" value={location}
        onChange={(e) => setLocation(e.target.value)} />
      {check.ok
        ? <p className="callout-ok">
            {check.value.visitType === 'overnight'
              ? 'Valid overnight visit — counts as 1.'
              : `Valid day visit — counts as ${check.value.dayCount}.`}
          </p>
        : <p className="callout-warn">{check.error}</p>}
      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !check.ok}
          onClick={() => void save()}>Save corrections</Button>
      </div>
    </Modal>
  );
}
