import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../api.ts";

/** Runs a loader and keeps its result. `reload` fetches again without blanking the screen. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiFailure; loading: boolean }>({
    loading: true,
  });
  const seq = useRef(0);
  const flying = useRef(false);
  const again = useRef(false);
  const latest = useRef<() => void>(() => {});
  const run = useCallback((fresh?: boolean) => {
    // Asked again while a fetch is on its way (several saves close together): ask once more when it lands, not
    // once per ask, so a burst of changes costs two requests and not one for each.
    if (flying.current && !fresh) {
      again.current = true;
      return;
    }
    const mine = ++seq.current;
    flying.current = true;
    setState((s) => ({ ...s, loading: true }));
    const done = () => {
      if (mine !== seq.current) return;
      flying.current = false;
      if (again.current) {
        again.current = false;
        latest.current();
      }
    };
    load().then(
      (data) => {
        if (mine === seq.current) setState({ data, loading: false });
        done();
      },
      (e) => {
        if (mine === seq.current)
          setState((s) => ({
            ...s,
            error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
            loading: false,
          }));
        done();
      },
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what the load depends on
  }, deps);
  latest.current = () => run();
  // A change of what the load depends on always fetches; only a plain reload joins one already on its way.
  useEffect(() => run(true), [run]);
  const reload = useCallback(() => latest.current(), []);
  return { ...state, reload };
}
