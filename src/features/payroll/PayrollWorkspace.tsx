import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PayrollPage } from './PayrollPage';
import { PayrollSummaryPage } from './PayrollSummaryPage';

type Tab = 'processing' | 'summary';

/**
 * Single Payroll workspace with two views. The old /admin/payroll-summary
 * route still resolves here and opens the Summary tab, so existing links and
 * bookmarks keep working.
 */
export function PayrollWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const initial: Tab = location.pathname.includes('payroll-summary') ? 'summary' : 'processing';
  const [tab, setTab] = useState<Tab>(initial);

  // Keep the URL in step with the visible tab so a refresh or share reopens it.
  useEffect(() => {
    const want = tab === 'summary' ? '/admin/payroll-summary' : '/admin/payroll';
    if (location.pathname !== want) navigate(want, { replace: true });
  }, [tab, location.pathname, navigate]);

  useEffect(() => { setTab(initial); }, [initial]);

  return (
    <>
      <div className="tabbar" role="tablist" aria-label="Payroll views">
        <button
          role="tab" aria-selected={tab === 'processing'}
          className={`tab ${tab === 'processing' ? 'is-active' : ''}`}
          onClick={() => setTab('processing')}
        >
          Processing
        </button>
        <button
          role="tab" aria-selected={tab === 'summary'}
          className={`tab ${tab === 'summary' ? 'is-active' : ''}`}
          onClick={() => setTab('summary')}
        >
          Summary
        </button>
      </div>
      {tab === 'processing' ? <PayrollPage /> : <PayrollSummaryPage />}
    </>
  );
}
