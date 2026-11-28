import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/api";

/**
 * One read from the server, kept on screen while it is asked for again. `path` null reads nothing. The error is
 * the server's own words, to be shown beside a "Try again" that calls `reload`.
 */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is how reload() asks again
  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    getJson<T>(path).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "That did not load.");
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
