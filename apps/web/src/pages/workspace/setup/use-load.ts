import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "@/api";

/**
 * Runs a loader and keeps its result. `reload` fetches again while the old data stays on screen (NAV-08), and a
 * failed load keeps what was there, with the error beside it for "Try again". `key` names what the load depends on.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data?: T; error?: ApiFailure; loading: boolean }>({
    loading: true,
  });
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what the loader depends on
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ data: s.data, loading: true }));
    loader.current().then(
      (data) => {
        if (mine === seq.current) setState({ data, loading: false });
      },
      (e) => {
        if (mine === seq.current)
          setState((s) => ({
            data: s.data,
            error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
            loading: false,
          }));
      },
    );
  }, [key]);
  useEffect(run, [run]);
  return { ...state, reload: run };
}
