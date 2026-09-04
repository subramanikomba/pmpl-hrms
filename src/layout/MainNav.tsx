import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';

interface NavItem { to: string; label: string }

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/attendance', label: 'Attendance' },
  { to: '/leave', label: 'Leave' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/outdoor-visits', label: 'Outdoor Visits' },
  { to: '/salary-slips', label: 'Salary Slips' },
];

const ADMIN_PRIMARY: NavItem[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/employees', label: 'Employees' },
  { to: '/admin/attendance', label: 'Attendance' },
  { to: '/admin/leave', label: 'Approvals' },
  { to: '/admin/payroll', label: 'Payroll' },
  { to: '/admin/salary-slips', label: 'Salary Slips' },
];

/** Grouped so the admin bar stays compact; routes are unchanged. */
interface NavGroup { heading: string; items: NavItem[] }

const ADMIN_MORE_GROUPS: NavGroup[] = [
  {
    heading: 'Expenses',
    items: [
      { to: '/admin/expenses', label: 'Expense Approvals' },
      { to: '/admin/expense-reports', label: 'Expense Reports' },
      { to: '/admin/outdoor-visits', label: 'Outdoor Visits' },
      { to: '/admin/company-advance', label: 'Company Advance & Expense Ledger' },
    ],
  },
  {
    heading: 'Payroll',
    items: [
      { to: '/admin/salary-advance', label: 'Salary Advance' },
      { to: '/admin/settings', label: 'Payroll Settings' },
    ],
  },
];

export function MainNav() {
  const { isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = isAdmin ? ADMIN_PRIMARY : EMPLOYEE_NAV;
  const close = () => { setMobileOpen(false); setMoreOpen(false); };

  return (
    <nav className={`mainnav ${mobileOpen ? 'is-open' : ''}`}>
      <div className="mainnav-inner">
        <button
          className="nav-burger"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
        >
          ☰ Menu
        </button>

        <div className="nav-links">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
              onClick={close}
            >
              {item.label}
            </NavLink>
          ))}

          {isAdmin && (
            <div className="nav-more">
              <button
                className="nav-link nav-more-btn"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
              >
                More ▾
              </button>
              {moreOpen && (
                <>
                  <div className="nav-more-backdrop" onClick={() => setMoreOpen(false)} />
                  <div className="nav-more-menu">
                    {ADMIN_MORE_GROUPS.map((group) => (
                      <div key={group.heading} className="nav-more-group">
                        <p className="nav-more-heading">{group.heading}</p>
                        {group.items.map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) => `nav-more-item ${isActive ? 'is-active' : ''}`}
                            onClick={close}
                          >
                            {item.label}
                          </NavLink>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
