import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryResult<T> {
  data: T | null;
  error: string | null;
  /** True only while there is nothing to display yet (first load). */
  loading: boolean;
  /** True while a background refresh is in flight and stale data is shown. */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Minimal async data hook: runs `fn` on mount and whenever `deps` change,
 * guards against setting state after unmount, and exposes a manual reload.
 * Deliberately small — a full data-fetching library is not warranted here.
 */
export function useQuery<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[] = [],
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    // Only show the blocking loading state on the FIRST load. On a reload
    // (after add/save/delete) we keep the previous data on screen, so the
    // page does not unmount and remount — which is what was resetting the
    // scroll position to the top after every action.
    setLoading((prev) => (data === null ? true : prev && data === null));
    setError(null);
    fn().then(
      (res) => { if (alive.current) { setData(res); setLoading(false); setRefreshing(false); } },
      (e: unknown) => {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setLoading(false); setRefreshing(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => {
    setRefreshing(true);
    setNonce((n) => n + 1);
  }, []);
  return { data, error, loading, refreshing, reload };
}
