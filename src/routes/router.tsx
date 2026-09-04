import { createHashRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/layout/AppLayout';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/features/LoginPage';
import { RootRedirect } from '@/routes/RootRedirect';
import { NotFound } from '@/routes/NotFound';

import { EmployeeAttendancePage } from '@/features/attendance/EmployeeAttendancePage';
import { LeaveHistoryPage } from '@/features/leave/LeaveHistoryPage';
import { MyExpensesPage } from '@/features/expenses/MyExpensesPage';
import { OutdoorVisitsPage } from '@/features/visits/OutdoorVisitsPage';
import { OutdoorVisitReportPage } from '@/features/visits/OutdoorVisitReportPage';

import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { AttendanceReportPage } from '@/features/attendance/AttendanceReportPage';
import { LeaveApprovalPage } from '@/features/leave/LeaveApprovalPage';
import { ExpenseApprovalPage } from '@/features/expenses/ExpenseApprovalPage';
import { ExpenseReportsPage } from '@/features/expenses/ExpenseReportsPage';
import { CompanyAdvancePage } from '@/features/advances/CompanyAdvancePage';
import { SalaryAdvancePage } from '@/features/advances/SalaryAdvancePage';
import { PayrollWorkspace } from '@/features/payroll/PayrollWorkspace';
import { SalarySlipsPage } from '@/features/payroll/SalarySlipsPage';
import { MySalarySlipsPage } from '@/features/payroll/MySalarySlipsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/**
 * Hash routing is used deliberately: the app is served from GitHub Pages,
 * which cannot rewrite deep paths to index.html for a browser-history router.
 */
export const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { index: true, element: <RootRedirect /> },

      // Employee
      { path: 'attendance', element: <EmployeeAttendancePage /> },
      { path: 'leave', element: <LeaveHistoryPage /> },
      { path: 'expenses', element: <MyExpensesPage /> },
      { path: 'outdoor-visits', element: <OutdoorVisitsPage /> },
      { path: 'salary-slips', element: <MySalarySlipsPage /> },

      // Admin
      { path: 'admin', element: <RequireAuth adminOnly><AdminDashboardPage /></RequireAuth> },
      { path: 'admin/employees', element: <RequireAuth adminOnly><EmployeesPage /></RequireAuth> },
      { path: 'admin/attendance', element: <RequireAuth adminOnly><AttendanceReportPage /></RequireAuth> },
      { path: 'admin/leave', element: <RequireAuth adminOnly><LeaveApprovalPage /></RequireAuth> },
      { path: 'admin/expenses', element: <RequireAuth adminOnly><ExpenseApprovalPage /></RequireAuth> },
      { path: 'admin/expense-reports', element: <RequireAuth adminOnly><ExpenseReportsPage /></RequireAuth> },
      { path: 'admin/outdoor-visits', element: <RequireAuth adminOnly><OutdoorVisitReportPage /></RequireAuth> },
      { path: 'admin/company-advance', element: <RequireAuth adminOnly><CompanyAdvancePage /></RequireAuth> },
      { path: 'admin/salary-advance', element: <RequireAuth adminOnly><SalaryAdvancePage /></RequireAuth> },
      { path: 'admin/payroll', element: <RequireAuth adminOnly><PayrollWorkspace /></RequireAuth> },
      // Legacy route preserved — opens the Summary tab of the same workspace.
      { path: 'admin/payroll-summary', element: <RequireAuth adminOnly><PayrollWorkspace /></RequireAuth> },
      { path: 'admin/salary-slips', element: <RequireAuth adminOnly><SalarySlipsPage /></RequireAuth> },
      { path: 'admin/settings', element: <RequireAuth adminOnly><SettingsPage /></RequireAuth> },

      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
