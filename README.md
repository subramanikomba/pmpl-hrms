# PMPL HRMS

Employee management, attendance and payroll for **Polyfill Microns Pvt. Ltd.**

Live: <https://hrms.polyfillmicrons.in>

## Stack

| Concern | Choice |
| --- | --- |
| UI | React 19 + TypeScript (strict) |
| Build | Vite |
| Routing | React Router (hash router — GitHub Pages cannot rewrite deep paths) |
| Backend | Supabase (Postgres + Auth + Row Level Security) |
| PWA | `vite-plugin-pwa` (Workbox) |
| Tests | Vitest |
| Hosting | GitHub Pages via GitHub Actions |

## Commands

```bash
npm install      # install dependencies
npm run dev      # local dev server
npm run typecheck# TypeScript, no emit
npm test         # unit tests
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build locally
```

## Architecture

```
src/
  assets/        logo
  auth/          AuthProvider, useAuth, RequireAuth route guard
  components/ui/ presentational primitives (Button, Card, Modal, DataTable…)
  features/      one folder per domain area, each owning its screens
  layout/        authenticated app shell (top bar, nav, inactivity dialog)
  lib/           supabase client, data-access layer, payroll rules, formatting
  routes/        route table
  styles/        single stylesheet with design tokens
  types/         database domain types
```

Principles worth preserving:

- **No global `window` functions.** Everything is a module import or React context.
- **No `innerHTML`.** All rendering goes through JSX, so values are escaped by React.
- **Business rules are pure functions** in `src/lib/payroll.ts`, independent of React
  and Supabase, and covered by unit tests.
- **All Supabase queries live in `src/lib/api.ts`** rather than inside components.
- **Authorisation is enforced by Postgres RLS.** The `RequireAuth` guard is
  UX only — it is not the security boundary.

## Security model

- Auth tokens are held in `sessionStorage`, so closing the browser ends the
  session. A same-tab reload stays signed in.
- Idle sessions warn at 25 minutes and sign out at 30.
- Every table has Row Level Security: employees can read only their own rows;
  admins have organisation-wide access.
- Creating employee logins requires the service role, so it runs in the
  `create-employee` Supabase Edge Function — never in the browser.

## Deployment

Pushing to `main` runs typecheck and tests; only if both pass does the build
deploy to GitHub Pages. Set **Settings → Pages → Source → GitHub Actions**, and
point a `CNAME` DNS record for `hrms` at `<user>.github.io`.
