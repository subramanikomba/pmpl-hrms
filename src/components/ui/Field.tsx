import type {
  InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode,
} from 'react';
import { useId } from 'react';

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

export function TextInput(
  { label, hint, ...rest }:
  { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <input id={id} className="input" {...rest} />}
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
