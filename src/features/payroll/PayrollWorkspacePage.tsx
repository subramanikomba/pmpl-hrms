import { NavLink, Navigate, useLocation } from 'react-router-dom';
import { PayrollPage } from './PayrollPage';
import { PayrollSummaryPage } from './PayrollSummaryPage';

/**
 * Payroll workspace: Processing and Summary as tabs under a single menu.
 * Both original routes still resolve here, so existing bookmarks keep working
 * and simply open the matching tab.
 */
export function PayrollWorkspacePage() {
  const { pathname } = useLocation();
  const onSummary = pathname.includes('payroll-summary');

  return (
    <>
      <div className="tabbar" role="tablist">
        <NavLink
          to="/admin/payroll"
          role="tab"
          aria-selected={!onSummary}
          className={`tab ${!onSummary ? 'is-active' : ''}`}
        >
          Processing
        </NavLink>
        <NavLink
          to="/admin/payroll-summary"
          role="tab"
          aria-selected={onSummary}
          className={`tab ${onSummary ? 'is-active' : ''}`}
        >
          Summary
        </NavLink>
      </div>
      {onSummary ? <PayrollSummaryPage /> : <PayrollPage />}
    </>
  );
}

/** Kept so an unknown payroll sub-path lands somewhere sensible. */
export function PayrollRedirect() {
  return <Navigate to="/admin/payroll" replace />;
}
