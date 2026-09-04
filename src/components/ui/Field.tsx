import type {
  InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode,
} from 'react';
import { useId, useRef } from 'react';
import type React from 'react';

export function Field(
  { label, hint, children }:
  { label: string; hint?: string; children: (id: string) => ReactNode },
) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/** Input types that open a native browser picker. */
const PICKER_TYPES = new Set(['date', 'month', 'time', 'week', 'datetime-local']);

export function TextInput(
  { label, hint, ...rest }:
  { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>,
) {
  const isPicker = typeof rest.type === 'string' && PICKER_TYPES.has(rest.type);
  // Browsers expose showPicker() but no hidePicker(), so track open state
  // ourselves to give the expected click-to-open / click-again-to-close.
  const pickerOpen = useRef(false);

  /**
   * Open the picker from a click anywhere in the field, not just on the small
   * calendar icon at the far right. Browsers anchor the popup to the field, so
   * keeping these inputs narrow (.input-picker) also keeps the popup beside
   * the icon instead of stranding it across the width of the form.
   * showPicker throws when unsupported or without user activation, so the
   * native icon remains the fallback.
   */
  function togglePicker(e: React.MouseEvent<HTMLInputElement>) {
    if (!isPicker) return;
    const el = e.currentTarget;
    if (typeof el.showPicker !== 'function' || el.readOnly || el.disabled) return;
    if (pickerOpen.current) {
      // Blur dismisses the open popup; focus is restored on the next click.
      pickerOpen.current = false;
      el.blur();
      return;
    }
    try {
      el.showPicker();
      pickerOpen.current = true;
    } catch {
      // Unsupported or no user activation — the native icon still works.
      pickerOpen.current = false;
    }
  }

  /** The popup is gone once the field loses focus or a value is chosen. */
  function clearPickerState() { pickerOpen.current = false; }

  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className={`input${isPicker ? ' input-picker' : ''}`}
          {...rest}
          onClick={isPicker ? togglePicker : rest.onClick}
          onBlur={isPicker
            ? (ev) => { clearPickerState(); rest.onBlur?.(ev); }
            : rest.onBlur}
          onChange={isPicker
            ? (ev) => { clearPickerState(); rest.onChange?.(ev); }
            : rest.onChange}
        />
      )}
    </Field>
  );
}

export function Select(
  { label, hint, children, ...rest }:
  { label: string; hint?: string } & SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <select id={id} className="input" {...rest}>{children}</select>}
    </Field>
  );
}

export function TextArea(
  { label, hint, ...rest }:
  { label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <textarea id={id} className="input" rows={3} {...rest} />}
    </Field>
  );
}

export function Checkbox(
  { label, ...rest }:
  { label: string } & InputHTMLAttributes<HTMLInputElement>,
) {
  const id = useId();
  return (
    <div className="checkbox-row">
      <input id={id} type="checkbox" {...rest} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
