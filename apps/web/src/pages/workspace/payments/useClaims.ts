import type { ClaimDto } from "@alimentation/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, getJson } from "@/api";

/**
 * The kitchen's claims. A refetch keeps what is on screen until the new list arrives (`refreshing`), and a failed
 * one keeps the last list and says so in `error`.
 */
export function useClaims(api: string) {
  const [data, setData] = useState<ClaimDto[] | undefined>();
  const [error, setError] = useState<ApiFailure | undefined>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    getJson<ClaimDto[]>(`${api}/claims`).then(
      (list) => {
        if (mine !== seq.current) return;
        setData(list);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        setError(e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)));
        setLoading(false);
      },
    );
  }, [api]);

  useEffect(() => {
    reload();
    return () => {
      seq.current++;
    };
  }, [reload]);

  return { data, error, loading, reload };
}
