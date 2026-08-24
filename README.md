# PMPL HRMS

**Polyfill Microns Pvt. Ltd. — Employee Management, Attendance & Payroll System**

Live URL: https://hrms.polyfillmicrons.in  
Backend: Supabase Project `pyuybtrkdlbpldffnyzy` (Mumbai / ap-south-1)

---

## First-Time Setup

### 1. Create the Admin User in Supabase

Go to **Supabase Dashboard → Authentication → Users → Invite User**  
Enter the admin email and send invitation. The admin sets their own password.

Then in **Supabase Dashboard → Table Editor → employees**, insert a row:
```
auth_user_id  → (paste the Auth user's UUID from Authentication → Users)
first_name    → Subramani
last_name     → (your last name)
username      → admin
contact_email → your@email.com
designation   → Director
is_admin      → true
status        → active
```

### 2. Deploy to GitHub Pages

Push this repository to `pmpl-hrms` on GitHub.  
Go to **Settings → Pages → Source → GitHub Actions**.  
The `deploy.yml` workflow will auto-deploy on every push to `main`.

### 3. Custom Domain (hrms.polyfillmicrons.in)

In your DNS provider, add:
```
Type: CNAME
Name: hrms
Value: subramanikomba.github.io
```

In GitHub Pages Settings → Custom Domain, enter `hrms.polyfillmicrons.in` and enable HTTPS.

---

## Project Structure

```
pmpl-hrms/
├── index.html              — Single-page application
├── manifest.json           — PWA manifest
├── sw.js                   — Service worker (offline support)
├── assets/
│   └── pmpl_logo.jpg       — Company logo
├── css/
│   └── style.css           — Application styles
├── js/
│   ├── config.js           — Supabase credentials
│   ├── app.js              — Auth, routing, shared utilities
│   └── screens/
│       ├── attendance.js        — Employee attendance dashboard
│       ├── admin-dashboard.js   — Admin overview
│       ├── admin-employees.js   — Employee & salary management
│       ├── admin-payroll.js     — Payroll calculation
│       ├── leave-expense.js     — Leave, expenses, advance ledger
│       ├── salary-slips.js      — PDF & Word slip generation
│       └── admin-settings.js    — Company settings & rules
└── .github/workflows/
    └── deploy.yml          — Auto-deploy to GitHub Pages
```

## Supabase Database

| Table | Purpose |
|-------|---------|
| `employees` | Employee profiles (linked to Auth) |
| `salary_structures` | Effective-dated salary components |
| `attendance` | Daily attendance records |
| `attendance_audit` | All attendance changes with history |
| `leave_requests` | Leave applications and approvals |
| `company_advances` | Company money given to employees |
| `company_expenses` | Employee expense claims |
| `company_advance_ledger` | View — running balance per employee |
| `salary_advances` | Salary advance records |
| `salary_advance_recoveries` | Payroll-wise recovery tracking |
| `payroll` | Monthly payroll records |
| `payroll_audit` | Lock/reopen audit trail |
| `company_settings` | PMPL company info and PT rates |
| `company_holidays` | Admin-configured paid holidays |
| `allowance_rules` | Configurable bonus/allowance percentages |
| `client_companies` | Client list for expense tagging |
