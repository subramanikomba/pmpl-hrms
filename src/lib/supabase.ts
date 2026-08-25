import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

/**
 * Auth state is stored in sessionStorage, not localStorage, so that closing
 * the browser ends the session and a fresh browser session must log in again.
 * A same-tab reload still keeps the user signed in.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
