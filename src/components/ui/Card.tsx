import type { ReactNode } from 'react';

export function Card(
  { title, actions, children, className = '', id }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode;
    className?: string; id?: string },
) {
  return (
    <section id={id} className={`card ${className}`.trim()}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard(
  { label, value, tone = 'default', hint }:
  {
    label: string; value: ReactNode;
    /** 'pending' marks money awaiting action — always coloured, unlike
     *  'warn', which is reserved for something overdue. */
    tone?: 'default' | 'warn' | 'good' | 'pending';
    /** Optional sub-line explaining what the figure covers. */
    hint?: string;
  },
) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
