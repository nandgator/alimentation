import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "@/api";

export interface Fetched<T> {
  /** What was fetched for the current key. While another key loads it is undefined; while the same key loads again it stays. */
  data: T | undefined;
  error: ApiFailure | undefined;
  /** Whether a request is in flight, the first or a refetch. */
  loading: boolean;
  /** Fetches again and keeps what is on screen until the new answer arrives. */
  reload: () => void;
  /** Replaces the data at once, for a change the person has made that the server has not yet confirmed. */
  mutate: (change: (old: T) => T) => void;
}

/**
 * One request as state, for the screens of Today, Meals and History. `key` names what is asked for (a day, a
 * window): when it changes the old answer is dropped, and when it stays the same, a `reload` keeps the old answer on
 * screen until the new one arrives. A late answer to an earlier request is ignored. With `enabled` false nothing is asked.
 */
export function useFetch<T>(key: string, load: () => Promise<T>, enabled = true): Fetched<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: ApiFailure }>({ key });
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback((k: string) => {
    const mine = ++seq.current;
    setLoading(true);
    loader.current().then(
      (data) => {
        if (mine !== seq.current) return;
        setState({ key: k, data });
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        const error = e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e));
        setState((s) => ({ key: k, data: s.key === k ? s.data : undefined, error }));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (enabled) run(key);
    else setLoading(false);
  }, [enabled, key, run]);

  const reload = useCallback(() => run(key), [run, key]);
  const mutate = useCallback(
    (change: (old: T) => T) =>
      setState((s) => (s.key === key && s.data !== undefined ? { ...s, data: change(s.data) } : s)),
    [key],
  );
  const mine = state.key === key ? state : undefined;
  return { data: mine?.data, error: mine?.error, loading, reload, mutate };
}
