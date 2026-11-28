import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, getJson } from "../../../api.ts";

export interface Fetched<T> {
  data: T | undefined;
  error: ApiFailure | null;
  /** The first read, with nothing yet to show. */
  loading: boolean;
  /** A later read, while the old data stays on screen (the plan's "a refetch replaces reload()"). */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Reads one address and keeps what it had while it reads again. A failed read leaves the last data in place and
 * says so in `error`, so a page shows its figures with a "Try again" and not a blank. `null` reads nothing.
 */
export function useApi<T>(path: string | null): Fetched<T> {
  const [state, setState] = useState<{ data?: T; error: ApiFailure | null; busy: boolean }>({
    error: null,
    busy: path !== null,
  });
  const seq = useRef(0);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload
  useEffect(() => {
    if (path === null) {
      setState({ error: null, busy: false });
      return;
    }
    const mine = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    getJson<T>(path).then(
      (data) => mine === seq.current && setState({ data, error: null, busy: false }),
      (e) =>
        mine === seq.current &&
        setState((s) => ({
          ...s,
          error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
          busy: false,
        })),
    );
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    data: state.data,
    error: state.error,
    loading: state.busy && state.data === undefined,
    refreshing: state.busy && state.data !== undefined,
    reload,
  };
}
