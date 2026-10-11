import { useMemo, useState } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { compOffApi } from '@/lib/api';
import { computePaidDays, isoDate } from '@/lib/payroll';
import { formatDate } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { AttendanceRecord, Employee } from '@/types/db';

/** A weekly off or company holiday this employee worked, this month. */
interface WorkedOffDay {
  date: string;
  isHoliday: boolean;
  /** Reserved as saved in the database, before anything in this panel. */
  wasReserved: boolean;
}

/** A day this month that is absent, or already settled as a comp_off. */
interface AbsentDay {
  date: string;
  /** The day it is settled against, as saved. '' when simply absent. */
  wasAgainst: string;
}

/**
 * Which days this month are weekly offs or company holidays, and which of
 * those the employee actually worked. Mirrors computePaidDays deliberately:
 * the same two cases it counts as workedWeeklyOffs and workedHolidays are
 * exactly the ones that may be settled against or reserved, and the database
 * trigger enforces the same rule again.
 */
function splitMonth(args: {
  month: Date;
  records: AttendanceRecord[];
  holidayDates: ReadonlySet<string>;
  workingDays?: readonly number[];
}): { worked: WorkedOffDay[]; absences: AbsentDay[] } {
  const { month, records, holidayDates } = args;
  const working = new Set(args.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const byDate = new Map(records.map((r) => [r.date, r] as const));

  const worked: WorkedOffDay[] = [];
  const absences: AbsentDay[] = [];
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  for (let day = 1; day <= total; day++) {
    const d = new Date(month.getFullYear(), month.getMonth(), day);
    const ds = isoDate(d);
    const rec = byDate.get(ds);
    const isHoliday = holidayDates.has(ds);
    const isOffDay = !working.has(d.getDay()) || isHoliday;

    if (isOffDay) {
      if (rec?.status === 'present') {
        worked.push({ date: ds, isHoliday, wasReserved: rec.off_day_use === 'reserved' });
      }
      continue;
    }
    if (rec?.status === 'absent') absences.push({ date: ds, wasAgainst: '' });
    if (rec?.status === 'comp_off') {
      absences.push({ date: ds, wasAgainst: rec.comp_off_against ?? '' });
    }
  }
  return { worked, absences };
}

/** "Holiday — 02 Oct 2026" or "Sunday, 04 Oct 2026". */
function describeDay(date: string, isHoliday = false): string {
  if (isHoliday) return `Holiday — ${formatDate(date)}`;
  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
  });
  return `${weekday}, ${formatDate(date)}`;
}

/**
 * Admin's decision, at payroll time, about days the employee worked on a
 * weekly off or holiday.
 *
 * One worked day earns the weekend bonus OR a day off, never both. The panel
 * asks the two questions in the order they actually arise:
 *
 *   1. Settle this month's absences against a day the employee worked.
 *   2. For anything left over, pay the bonus (the default) or reserve it so
 *      the employee can take a day off in a LATER month.
 *
 * Settling is the common case, so it comes first; reserving is then only
 * ever about carrying a day forward, which is what the word now means here.
 */
export function WeekendWorkingModal(props: {
  employee: Employee;
  month: Date;
  /** This employee's attendance for the month. */
  records: AttendanceRecord[];
  holidayDates: ReadonlySet<string>;
  workingDays?: readonly number[];
  /** Reserved days still unspent, including ones carried from earlier months. */
  carried: AttendanceRecord[];
  onClose: () => void;
  /** Called after a successful save, with the newly computed paid days. */
  onSaved: (paidDays: number) => void;
}) {
  const {
    employee, month, records, holidayDates, workingDays, carried,
    onClose, onSaved,
  } = props;
  const toast = useToast();

  const { worked, absences } = useMemo(
    () => splitMonth({ month, records, holidayDates, workingDays }),
    [month, records, holidayDates, workingDays],
  );

  // What Admin has chosen in this panel, seeded from what is already saved.
  const [against, setAgainst] = useState<Record<string, string>>(
    () => Object.fromEntries(absences.map((a) => [a.date, a.wasAgainst])),
  );
  const [reserved, setReserved] = useState<Set<string>>(
    // Only days reserved AND not settled are leftovers; a settled day's
    // reservation is implied by the settlement, not chosen here.
    () => new Set(
      worked
        .filter((w) => w.wasReserved)
        .filter((w) => !absences.some((a) => a.wasAgainst === w.date))
        .map((w) => w.date),
    ),
  );
  const [saving, setSaving] = useState(false);

  /** Reserved days carried in from an earlier month, still unspent. */
  const earlier = useMemo(() => carried
    .filter((c) => c.employee_id === employee.id && c.date < isoDate(month))
    .map((c) => c.date)
    .sort(), [carried, employee.id, month]);

  /** Days already chosen for some OTHER absence. */
  function takenElsewhere(exceptDate: string): Set<string> {
    return new Set(
      Object.entries(against)
        .filter(([d, v]) => d !== exceptDate && v)
        .map(([, v]) => v),
    );
  }

  function optionsFor(absenceDate: string): { date: string; label: string }[] {
    const taken = takenElsewhere(absenceDate);
    const thisMonth = worked.map((w) => ({
      date: w.date, label: describeDay(w.date, w.isHoliday),
    }));
    const carriedOpts = earlier.map((d) => ({
      date: d, label: `Reserved: ${describeDay(d)}`,
    }));
    return [...carriedOpts, ...thisMonth]
      .filter((o) => !taken.has(o.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** This month's worked days that no absence is settled against. */
  const settledHere = new Set(Object.values(against).filter(Boolean));
  const leftovers = worked.filter((w) => !settledHere.has(w.date));

  /*
   * The consequence, computed by running the real payroll function over the
   * records as this panel would leave them. Deriving it any other way would
   * risk the preview and the payroll disagreeing.
   */
  const preview = useMemo(() => {
    const patched: AttendanceRecord[] = records.map((r) => {
      if (worked.some((w) => w.date === r.date)) {
        // A day is withheld from the bonus when it is settled against OR
        // reserved — both mean it has been spent on a day off.
        const spent = settledHere.has(r.date) || reserved.has(r.date);
        return { ...r, off_day_use: spent ? 'reserved' : null };
      }
      if (absences.some((a) => a.date === r.date)) {
        const pick = against[r.date];
        return pick
          ? { ...r, status: 'comp_off' as const, comp_off_against: pick }
          : { ...r, status: 'absent' as const, comp_off_against: null };
      }
      return r;
    });
    return {
      now: computePaidDays({ month, records, holidayDates, workingDays }),
      next: computePaidDays({ month, records: patched, holidayDates, workingDays }),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, worked, absences, reserved, against, month, holidayDates, workingDays]);

  const changed = preview.now.paidDays !== preview.next.paidDays
    || preview.now.workedOffDays !== preview.next.workedOffDays;

  async function save() {
    setSaving(true);
    try {
      // A day an absence is settled against must itself be reserved — that is
      // what the database records as "spent" — so settled days join the
      // reserve list here rather than needing a separate tick.
      const toReserve = new Set([...reserved, ...settledHere]);

      await compOffApi.applyChanges(employee.id, {
        // Undo first, release second, reserve third, settle last: a reserved
        // day cannot be released while something is settled against it, and
        // an absence cannot be settled against a day not yet reserved.
        unsettle: absences
          .filter((a) => a.wasAgainst && against[a.date] !== a.wasAgainst)
          .map((a) => ({ employeeId: employee.id, date: a.date })),
        release: worked
          .filter((w) => w.wasReserved && !toReserve.has(w.date))
          .map((w) => ({ employeeId: employee.id, date: w.date })),
        reserve: worked
          .filter((w) => !w.wasReserved && toReserve.has(w.date))
          .map((w) => ({ employeeId: employee.id, date: w.date })),
        settle: absences
          .filter((a) => against[a.date] && against[a.date] !== a.wasAgainst)
          .map((a) => ({
            employeeId: employee.id, date: a.date, against: against[a.date]!,
          })),
      });
      toast.success('Weekend working updated.');
      onSaved(preview.next.paidDays);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the changes');
    } finally {
      setSaving(false);
    }
  }

  const nothingToDo = worked.length === 0 && absences.length === 0;

  return (
    <Modal open title={`Weekend working — ${employee.first_name} ${employee.last_name}`}
      onClose={onClose}>

      {absences.length > 0 && (
        <section className="swap-sec">
          <h4>Absent days</h4>
          <p className="swap-hint">
            Settle an absence against a weekly off or holiday the employee
            worked, and it is paid instead of cut.
          </p>
          {absences.map((a) => {
            const opts = optionsFor(a.date);
            return (
              <div className="swap-day" key={a.date}>
                <span>{describeDay(a.date)}</span>
                <select className="input" value={against[a.date] ?? ''}
                  disabled={opts.length === 0 && !against[a.date]}
                  onChange={(e) => setAgainst((prev) => ({
                    ...prev, [a.date]: e.target.value,
                  }))}>
                  <option value="">
                    {opts.length === 0 && !against[a.date]
                      ? 'No day available'
                      : 'Leave as absent'}
                  </option>
                  {opts.map((o) => (
                    <option key={o.date} value={o.date}>{o.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </section>
      )}

      {/*
        * Only what the first section did not consume. Settling a day removes
        * it from here, because a day spent on an absence is no longer a
        * leftover to make a decision about.
        */}
      {leftovers.length > 0 && (
        <section className="swap-sec">
          <h4>Days not settled</h4>
          <p className="swap-hint">
            These pay the weekend bonus. Reserve one instead to let the
            employee take a day off in a later month.
          </p>
          {leftovers.map((w) => (
            <div className="swap-day" key={w.date}>
              <span>{describeDay(w.date, w.isHoliday)}</span>
              <label className="swap-keep">
                <input type="checkbox" checked={reserved.has(w.date)}
                  onChange={(e) => setReserved((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(w.date);
                    else next.delete(w.date);
                    return next;
                  })} />
                Reserve for later
              </label>
            </div>
          ))}
        </section>
      )}

      {nothingToDo && (
        <p className="muted">
          No weekly offs or holidays were worked this month, and there are no
          absences to settle.
        </p>
      )}

      <p className="swap-result">
        Paid days{' '}
        {changed && <span className="was">{preview.now.paidDays}</span>}
        <strong>{preview.next.paidDays}</strong>
        {' · '}Weekend bonus{' '}
        {changed && (
          <span className="was">
            {preview.now.workedOffDays} day{preview.now.workedOffDays === 1 ? '' : 's'}
          </span>
        )}
        <strong>
          {preview.next.workedOffDays} day{preview.next.workedOffDays === 1 ? '' : 's'}
        </strong>
      </p>

      <div className="row-end gap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
