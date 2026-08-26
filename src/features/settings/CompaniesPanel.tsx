import { useState } from 'react';
import { clientApi, locationApi } from '@/lib/api';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/ToastProvider';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { TextInput } from '@/components/ui/Field';
import type { ClientWithLocations } from '@/types/db';

/**
 * Companies and their locations. Purely descriptive reference data — editing a
 * name here never rewrites payroll, salary slips or past expense transactions,
 * because those records reference the company by id, not by name.
 */
export function CompaniesPanel() {
  const toast = useToast();
  const q = useQuery(() => clientApi.listWithLocations(), []);

  const [name, setName] = useState('');
  const [locations, setLocations] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLocationAt(i: number, v: string) {
    setLocations((ls) => ls.map((l, idx) => (idx === i ? v : l)));
  }
  function addLocationField() { setLocations((ls) => [...ls, '']); }
  function removeLocationField(i: number) {
    setLocations((ls) => (ls.length === 1 ? [''] : ls.filter((_, idx) => idx !== i)));
  }

  async function addCompany() {
    if (!name.trim()) { setError('Enter a client name.'); return; }
    setError(null); setSaving(true);
    try {
      await clientApi.add(name.trim(), locations);
      toast.success('Client added.');
      setName(''); setLocations(['']);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add client');
    } finally { setSaving(false); }
  }

  return (
    <Card title="Clients & locations">
      <p className="muted small">
        Clients and their sites. Names are descriptive only — renaming one does
        not affect existing expenses, payroll or salary slips.
      </p>

      {/* ── Add form: name on the left, locations on the right ── */}
      <div className="company-form">
        <div className="company-form-name">
          <TextInput
            label="Client name" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name"
          />
        </div>
        <div className="company-form-locs">
          <label className="field-label">Locations</label>
          {locations.map((loc, i) => (
            <div className="loc-row" key={i}>
              <input
                className="input" value={loc}
                placeholder="Location (city / plant)"
                onChange={(e) => setLocationAt(i, e.target.value)}
              />
              <Button
                variant="ghost" size="sm" aria-label="Remove location"
                onClick={() => removeLocationField(i)}
              >
                −
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addLocationField}>
            + location
          </Button>
        </div>
      </div>

      <div className="company-form-actions">
        <Button variant="primary" disabled={saving} onClick={() => void addCompany()}>
          {saving ? 'Adding…' : 'Add client + locations'}
        </Button>
        {error && <p className="error-text small">{error}</p>}
      </div>

      {q.loading ? <Spinner /> : (
        <div className="company-list">
          {(q.data ?? []).length === 0
            ? <p className="muted">No clients added yet.</p>
            : (q.data ?? []).map((c) => (
              <CompanyRow key={c.id} company={c} onChanged={q.reload} />
            ))}
        </div>
      )}
    </Card>
  );
}

function CompanyRow(
  { company, onChanged }: { company: ClientWithLocations; onChanged: () => void },
) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(company.name);
  const [newLoc, setNewLoc] = useState('');
  const [editingLoc, setEditingLoc] = useState<string | null>(null);
  const [locDraft, setLocDraft] = useState('');

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
  }

  return (
    <div className={`company-card ${company.is_active ? '' : 'is-inactive'}`}>
      <div className="company-head">
        {renaming ? (
          <div className="rename-row">
            <input
              className="input" value={draftName} autoFocus
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && draftName.trim()) {
                void run(() => clientApi.rename(company.id, draftName.trim()), 'Client renamed.');
                setRenaming(false);
              } }}
            />
            <Button variant="primary" size="sm"
              disabled={!draftName.trim()}
              onClick={() => {
                void run(() => clientApi.rename(company.id, draftName.trim()), 'Client renamed.');
                setRenaming(false);
              }}>Save</Button>
            <Button variant="ghost" size="sm"
              onClick={() => { setRenaming(false); setDraftName(company.name); }}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <span className="company-name">{company.name}</span>
            <StatusBadge status={company.is_active ? 'active' : 'inactive'} />
            <div className="company-actions">
              <Button size="sm" onClick={() => setRenaming(true)}>Rename</Button>
              <Button size="sm" variant="ghost"
                onClick={() => void run(
                  () => clientApi.setActive(company.id, !company.is_active),
                  company.is_active ? 'Client deactivated.' : 'Client activated.',
                )}>
                {company.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="loc-chips">
        {company.locations.length === 0 && (
          <span className="muted small">No locations yet.</span>
        )}
        {company.locations.map((l) => (
          editingLoc === l.id ? (
            <span className="loc-edit" key={l.id}>
              <input
                className="input" value={locDraft} autoFocus
                onChange={(e) => setLocDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && locDraft.trim()) {
                  void run(() => locationApi.rename(l.id, locDraft), 'Location updated.');
                  setEditingLoc(null);
                } }}
              />
              <Button variant="primary" size="sm" disabled={!locDraft.trim()}
                onClick={() => {
                  void run(() => locationApi.rename(l.id, locDraft), 'Location updated.');
                  setEditingLoc(null);
                }}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingLoc(null)}>Cancel</Button>
            </span>
          ) : (
            <span className="loc-chip" key={l.id}>
              <button className="loc-chip-name"
                title="Rename location"
                onClick={() => { setEditingLoc(l.id); setLocDraft(l.name); }}>
                {l.name}
              </button>
              <button className="loc-chip-x" aria-label={`Remove ${l.name}`}
                onClick={() => void run(() => locationApi.remove(l.id), 'Location removed.')}>
                ×
              </button>
            </span>
          )
        ))}
      </div>

      <div className="loc-add">
        <input
          className="input" value={newLoc} placeholder="Add a location"
          onChange={(e) => setNewLoc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newLoc.trim()) {
            void run(() => locationApi.add(company.id, newLoc), 'Location added.');
            setNewLoc('');
          } }}
        />
        <Button variant="primary" size="sm" disabled={!newLoc.trim()}
          onClick={() => {
            void run(() => locationApi.add(company.id, newLoc), 'Location added.');
            setNewLoc('');
          }}>Add</Button>
      </div>
    </div>
  );
}
