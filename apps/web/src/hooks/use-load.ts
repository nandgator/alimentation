import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../api.ts";

/** Runs a loader and keeps its result. `reload` fetches again without blanking the screen. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiFailure; loading: boolean }>({
    loading: true,
  });
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => mine === seq.current && setState({ data, loading: false }),
      (e) =>
        mine === seq.current &&
        setState((s) => ({
          ...s,
          error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
          loading: false,
        })),
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what the load depends on
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}
