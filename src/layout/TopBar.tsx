import { useAuth } from '@/auth/useAuth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import logo from '@/assets/logo.jpg';

export function TopBar() {
  const { employee, isAdmin, signOut } = useAuth();
  if (!employee) return null;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <img src={logo} alt="" className="topbar-logo" />
        <div className="topbar-brand">
          <span className="brand-name">PMPL HRMS</span>
          <span className="brand-sub">Polyfill Microns Pvt. Ltd.</span>
        </div>
        <div className="topbar-user">
          <div className="user-meta">
            <span className="user-name">
              {employee.first_name} {employee.last_name}
            </span>
            <Badge tone={isAdmin ? 'danger' : 'info'}>
              {isAdmin ? 'Admin' : 'Employee'}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}
