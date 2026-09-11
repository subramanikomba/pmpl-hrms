import { useState } from 'react';
import { useQuery } from '@/lib/useQuery';
import {
  attendanceChangeApi, expenseApi, leaveApi, outdoorVisitApi,
} from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { LeaveApprovalPage } from '@/features/leave/LeaveApprovalPage';
import { VisitApprovalSection } from '@/features/visits/VisitApprovalSection';
import { ExpenseApprovalPage } from '@/features/expenses/ExpenseApprovalPage';

type Tab = 'corrections' | 'leave' | 'visits' | 'expenses';

/**
 * Everything waiting for an Admin decision, in one place.
 *
 * Purely a grouping of the existing approval screens — each tab renders the
 * same component that previously had its own route, with its own logic
 * untouched. The counts are pending items only, so the Admin can see where
 * the work is without opening each tab.
 */
export function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('corrections');

  const counts = useQuery(async () => {
    const [corrections, leave, visits, expenses] = await Promise.all([
      attendanceChangeApi.listAll('pending'),
      leaveApi.listAll('pending'),
      outdoorVisitApi.listPending(),
      expenseApi.listAll({ status: 'pending' }),
    ]);
    return {
      corrections: corrections.length,
      leave: leave.length,
      visits: visits.length,
      expenses: expenses.length,
    };
  }, []);

  const n = counts.data;
  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'corrections', label: 'Attendance Corrections', count: n?.corrections },
    { key: 'leave', label: 'Leave', count: n?.leave },
    { key: 'visits', label: 'Outdoor Visits', count: n?.visits },
    { key: 'expenses', label: 'Expenses', count: n?.expenses },
  ];

  const total = n
    ? n.corrections + n.leave + n.visits + n.expenses
    : 0;

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={total > 0
          ? `${total} item${total === 1 ? '' : 's'} waiting for your decision`
          : 'Nothing is waiting for your decision'}
      />

      <div className="tabbar" role="tablist" aria-label="Approval areas">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'corrections' && <LeaveApprovalPage only="corrections" />}
      {tab === 'leave' && <LeaveApprovalPage only="leave" />}
      {tab === 'visits' && <VisitApprovalSection />}
      {tab === 'expenses' && <ExpenseApprovalPage embedded />}
    </>
  );
}
