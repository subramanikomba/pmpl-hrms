import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button(
  { variant = 'secondary', size = 'md', className = '', children, ...rest }: Props,
) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
