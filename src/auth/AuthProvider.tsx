import {
  createContext, useCallback, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { INACTIVITY_LOGOUT_MS, INACTIVITY_WARN_MS } from '@/lib/config';
import type { Employee } from '@/types/db';

export interface AuthState {
  /** null = signed out; undefined = still resolving the initial session. */
  session: Session | null | undefined;
  employee: Employee | null;
  isAdmin: boolean;
  loading: boolean;
  /** True while the pre-logout inactivity warning is showing. */
  inactivityWarning: boolean;
  msUntilLogout: number;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  dismissInactivityWarning: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [msUntilLogout, setMsUntilLogout] = useState(0);

  const warnTimer = useRef<number | null>(null);
  const logoutTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    for (const t of [warnTimer, logoutTimer, tickTimer]) {
      if (t.current !== null) { window.clearInterval(t.current); window.clearTimeout(t.current); t.current = null; }
    }
    setInactivityWarning(false);
  }, []);

  const signOut = useCallback(async () => {
    clearTimers();
    await supabase.auth.signOut();
    setEmployee(null);
    setSession(null);
  }, [clearTimers]);

  /** (Re)start the inactivity countdown. Called on any genuine user activity. */
  const resetInactivity = useCallback(() => {
    clearTimers();
    warnTimer.current = window.setTimeout(() => {
      setInactivityWarning(true);
      let remaining = INACTIVITY_LOGOUT_MS - INACTIVITY_WARN_MS;
      setMsUntilLogout(remaining);
      tickTimer.current = window.setInterval(() => {
        remaining -= 1000;
        setMsUntilLogout(remaining > 0 ? remaining : 0);
      }, 1000);
    }, INACTIVITY_WARN_MS);

    logoutTimer.current = window.setTimeout(() => {
      void signOut();
    }, INACTIVITY_LOGOUT_MS);
  }, [clearTimers, signOut]);

  /** Load the employee profile for a signed-in auth user. */
  const loadEmployee = useCallback(async (userId: string): Promise<Employee | null> => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    const emp = data as Employee;
    // A deactivated account must not retain access.
    if (emp.status !== 'active') return null;
    return emp;
  }, []);

  // Initial session resolution + auth state subscription.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        const emp = await loadEmployee(data.session.user.id);
        if (cancelled) return;
        if (emp) { setSession(data.session); setEmployee(emp); resetInactivity(); }
        else { await supabase.auth.signOut(); setSession(null); setEmployee(null); }
      } else {
        setSession(null);
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT' || !newSession) {
        clearTimers();
        setSession(null);
        setEmployee(null);
        return;
      }
      if (event === 'SIGNED_IN') {
        void (async () => {
          const emp = await loadEmployee(newSession.user.id);
          if (cancelled) return;
          if (emp) { setSession(newSession); setEmployee(emp); resetInactivity(); }
          else { await supabase.auth.signOut(); }
        })();
      }
      // TOKEN_REFRESHED: keep the refreshed session, no profile reload needed.
      if (event === 'TOKEN_REFRESHED') setSession(newSession);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [loadEmployee, resetInactivity, clearTimers]);

  // Activity listeners — only while authenticated and not already warning.
  useEffect(() => {
    if (!employee) return;
    const onActivity = () => {
      // While the warning modal is up, only an explicit choice should
      // extend the session — passive scrolling should not.
      if (!inactivityWarning) resetInactivity();
    };
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, onActivity, { passive: true });
    }
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
    };
  }, [employee, inactivityWarning, resetInactivity]);

  // Clean up timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    employee,
    isAdmin: employee?.is_admin ?? false,
    loading,
    inactivityWarning,
    msUntilLogout,
    signIn,
    signOut,
    dismissInactivityWarning: resetInactivity,
  }), [session, employee, loading, inactivityWarning, msUntilLogout,
       signIn, signOut, resetInactivity]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
