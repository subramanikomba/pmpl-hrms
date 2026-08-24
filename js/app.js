// PMPL HRMS — Core Application
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.sb = supabase;

// ── State ─────────────────────────────────────────────────────
window.appState = {
  user: null,
  employee: null,
  isAdmin: false,
};

// ── Auth ──────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadEmployee(session.user);
  } else {
    showScreen('login');
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await loadEmployee(session.user);
    } else {
      window.appState = { user: null, employee: null, isAdmin: false };
      showScreen('login');
    }
  });
}

async function loadEmployee(user) {
  window.appState.user = user;
  const { data: emp, error } = await supabase
    .from('employees')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (error || !emp) {
    showToast('Employee profile not found. Contact Admin.', 'error');
    await supabase.auth.signOut();
    return;
  }

  window.appState.employee = emp;
  window.appState.isAdmin = emp.is_admin;

  if (emp.is_admin) {
    showScreen('admin-dashboard');
  } else {
    showScreen('attendance');
  }
}

// ── Screen Router ─────────────────────────────────────────────
const ADMIN_SCREENS = [
  'admin-dashboard','admin-employees','admin-attendance',
  'admin-leave-approval','admin-expense-approval',
  'admin-advance-ledger','admin-expense-reports',
  'admin-payroll','admin-payroll-summary','admin-salary-slips',
  'admin-settings'
];
const EMP_SCREENS = ['attendance','leave-history','my-expenses'];

window.showScreen = function(screenId) {
  // Guard: non-admin cannot access admin screens
  if (!window.appState.isAdmin && ADMIN_SCREENS.includes(screenId)) {
    showToast('Access denied', 'error');
    return;
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById('screen-' + screenId);
  if (target) {
    target.classList.remove('hidden');
    target.dispatchEvent(new Event('screen:show'));
  }

  // Update nav active state
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === screenId);
  });
};

// ── Login ─────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const btn   = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    showToast(error.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
};

window.doLogout = async function() {
  await supabase.auth.signOut();
};

// ── Toast ─────────────────────────────────────────────────────
window.showToast = function(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
};

// ── Date Helpers ──────────────────────────────────────────────
window.monthStart = (date) => {
  const d = date || new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
window.fmtDate = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
};
window.fmtMonth = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-IN', { month:'long', year:'numeric' });
};
window.fmtCurrency = (n) => '₹' + Number(n||0).toLocaleString('en-IN', { minimumFractionDigits:2 });
window.isoDate = (d) => {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

// ── Payroll Lock Check ────────────────────────────────────────
window.isPayrollMonthLocked = function(payrollMonth) {
  // Locked after the 10th of the following month
  const pm = new Date(payrollMonth);
  const lockDate = new Date(pm.getFullYear(), pm.getMonth()+1, 10);
  return new Date() > lockDate;
};

// ── Nav helper ────────────────────────────────────────────────
window.initNav = function() {
  const isAdmin = window.appState.isAdmin;
  document.getElementById('nav-admin').classList.toggle('hidden', !isAdmin);
  document.getElementById('nav-emp').classList.toggle('hidden', isAdmin);
  document.getElementById('nav-bar').classList.remove('hidden');
  document.getElementById('user-name-display').textContent =
    window.appState.employee?.first_name + ' ' + window.appState.employee?.last_name;
};

// ── Admin More Menu ───────────────────────────────────────────
window.toggleAdminMore = function () {
  const menu = document.getElementById('admin-more-menu');
  menu.classList.toggle('hidden');
};

// Close more menu when tapping outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('admin-more-menu');
  if (menu && !menu.classList.contains('hidden')) {
    const nav  = document.getElementById('nav-bar');
    if (!nav?.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  }
});

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initAuth);
