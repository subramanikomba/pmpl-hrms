import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { MainNav } from './MainNav';
import { InactivityDialog } from './InactivityDialog';

export function AppLayout() {
  return (
    <div className="app-shell">
      <TopBar />
      <MainNav />
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        Polyfill Microns Pvt. Ltd. — Internal HRMS · Phase 1
      </footer>
      <InactivityDialog />
    </div>
  );
}
