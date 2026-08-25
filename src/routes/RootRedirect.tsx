import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';

/** Admins land on the dashboard; employees on their attendance screen. */
export function RootRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/admin' : '/attendance'} replace />;
}
