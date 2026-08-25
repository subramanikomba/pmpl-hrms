import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Route guard. Renders children only for an authenticated employee;
 * `adminOnly` routes additionally require the admin flag.
 *
 * This is defence-in-depth for UX only — the authoritative check is the
 * Row Level Security policy on every table in Postgres.
 */
export function RequireAuth(
  { children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean },
) {
  const { employee, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Loading…" />;
  if (!employee) return <Navigate to="/login" replace state={{ from: location }} />;
  if (adminOnly && !employee.is_admin) return <Navigate to="/attendance" replace />;

  return <>{children}</>;
}
