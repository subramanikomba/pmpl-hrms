import { minutesOf } from '@/lib/visits';

/**
 * Employee-facing time entry as Hour : Minute AM/PM.
 *
 * Deliberately not <input type="time">: that renders a 24-hour clock on many
 * Android builds regardless of locale, and these times decide whether a visit
 * is a day or an overnight one. Value in/out stays "HH:MM" so storage and the
 * validation rules keep working in 24-hour form.
 */
export function TimeInput(
  { label, value, onChange, hint }: {
    label: string;
    /** "HH:MM" in 24-hour form, or '' when unset. */
    value: string;
    onChange: (next: string) => void;
    hint?: string;
  },
) {
  const mins = value ? minutesOf(value) : null;
  const h24 = mins === null ? null : Math.floor(mins / 60);
  const hour12 = h24 === null ? '' : String(h24 % 12 === 0 ? 12 : h24 % 12);
  const minute = mins === null ? '' : String(mins % 60).padStart(2, '0');
  const meridiem = h24 === null ? 'AM' : (h24 < 12 ? 'AM' : 'PM');

  function emit(h: string, m: string, ap: string) {
    if (!h || !m) { onChange(''); return; }
    let hh = Number(h) % 12;
    if (ap === 'PM') hh += 12;
    onChange(`${String(hh).padStart(2, '0')}:${m}`);
  }

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="time-input">
        <select aria-label={`${label} hour`} value={hour12}
          onChange={(e) => emit(e.target.value, minute || '00', meridiem)}>
          <option value="">--</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="time-sep">:</span>
        <select aria-label={`${label} minute`} value={minute}
          onChange={(e) => emit(hour12 || '12', e.target.value, meridiem)}>
          <option value="">--</option>
          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
            .map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label={`${label} AM or PM`} value={meridiem}
          onChange={(e) => emit(hour12 || '12', minute || '00', e.target.value)}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
