import { useEffect, useState } from 'react';
import { clientApi } from '@/lib/api';
import { Select } from '@/components/ui/Field';
import type { ClientLocation } from '@/types/db';

/**
 * Optional picker for one of the selected client's sites.
 *
 * Renders nothing until a client is chosen, and nothing if that client has no
 * locations on record — a client with a single unnamed site should not make
 * the employee answer a pointless question. Clearing the client clears the
 * location, so a stale site can never be saved against a different company.
 */
export function ClientLocationSelect(
  { clientId, value, onChange, label = 'Client location (optional)' }: {
    clientId: string;
    value: string;
    onChange: (locationId: string) => void;
    label?: string;
  },
) {
  const [locations, setLocations] = useState<ClientLocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      setLocations([]);
      onChange('');
      return;
    }
    void clientApi.locationsFor(clientId).then((rows) => {
      if (cancelled) return;
      setLocations(rows);
      // Drop a selection that does not belong to the newly chosen client.
      if (value && !rows.some((r) => r.id === value)) onChange('');
    }).catch(() => { if (!cancelled) setLocations([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId || locations.length === 0) return null;

  return (
    <Select label={label} value={value}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">— Not specified —</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </Select>
  );
}
