// PMPL HRMS — Service Worker
const CACHE = 'pmpl-hrms-v2';
const STATIC = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/app.js',
  '/js/screens/attendance.js',
  '/js/screens/admin-dashboard.js',
  '/js/screens/admin-employees.js',
  '/js/screens/admin-payroll.js',
  '/js/screens/admin-payroll-summary.js',
  '/js/screens/admin-attendance.js',
  '/js/screens/admin-leave-approval.js',
  '/js/screens/admin-expense-approval.js',
  '/js/screens/admin-expense-reports.js',
  '/js/screens/admin-salary-advance.js',
  '/js/screens/leave-expense.js',
  '/js/screens/salary-slips.js',
  '/js/screens/admin-settings.js',
  '/assets/pmpl_logo.jpg',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for Supabase API calls
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
