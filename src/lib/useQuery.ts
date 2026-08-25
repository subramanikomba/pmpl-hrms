import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
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
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fn().then(
      (res) => { if (alive.current) { setData(res); setLoading(false); } },
      (e: unknown) => {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
