/**
 * Supabase connection settings.
 *
 * The anon key is a public, RLS-scoped key — it is safe in client code.
 * All real authorisation is enforced by Row Level Security in Postgres.
 */
export const SUPABASE_URL = 'https://pyuybtrkdlbpldffnyzy.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5dXlidHJrZGxicGxkZmZueXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1Nzk5NDMsImV4cCI6MjEwMzE1NTk0M30.RVBcxrbs4dY2dUAre8BrtrJsuvil0lfFn9cVsPNM_nA';

/** Inactivity policy (spec: 30 min timeout, warning shown beforehand). */
export const INACTIVITY_WARN_MS = 25 * 60 * 1000;
export const INACTIVITY_LOGOUT_MS = 30 * 60 * 1000;
