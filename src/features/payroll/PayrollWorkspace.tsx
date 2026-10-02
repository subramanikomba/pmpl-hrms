import { useLocation, useNavigate } from 'react-router-dom';
import { PayrollPage } from './PayrollPage';
import { PayrollSummaryPage } from './PayrollSummaryPage';

type Tab = 'processing' | 'summary';

const PATH: Record<Tab, string> = {
  processing: '/admin/payroll',
  summary: '/admin/payroll-summary',
};

/**
 * Single Payroll workspace with two views. The old /admin/payroll-summary
 * route still resolves here and opens the Summary tab, so existing links and
 * bookmarks keep working.
 *
 * The URL is the ONLY source of truth for which tab is open. There is
 * deliberately no `tab` state and no effect syncing state to the URL: an
 * earlier version held both, with one effect pushing the URL to match the state
 * and another pushing the state to match the URL. Navigating here from the nav
 * while Summary was open made those two undo each other on every render — the
 * screen ping-ponged between the two tabs indefinitely. Deriving the tab makes
 * that class of bug impossible rather than merely fixed.
 */
export function PayrollWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab: Tab = location.pathname.includes('payroll-summary')
    ? 'summary' : 'processing';

  /** replace, not push, so the two tabs do not pile up in browser history. */
  function show(next: Tab) {
    if (next !== tab) navigate(PATH[next], { replace: true });
  }

  return (
    <>
      <div className="tabbar" role="tablist" aria-label="Payroll views">
        <button
          role="tab" aria-selected={tab === 'processing'}
          className={`tab ${tab === 'processing' ? 'is-active' : ''}`}
          onClick={() => show('processing')}
        >
          Processing
        </button>
        <button
          role="tab" aria-selected={tab === 'summary'}
          className={`tab ${tab === 'summary' ? 'is-active' : ''}`}
          onClick={() => show('summary')}
        >
          Summary
        </button>
      </div>
      {tab === 'processing' ? <PayrollPage /> : <PayrollSummaryPage />}
    </>
  );
}
