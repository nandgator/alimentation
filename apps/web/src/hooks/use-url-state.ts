import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * One search parameter as state, so a month, a tab or a filter survives a reload and a shared link (NAV-16).
 * The value is a string; `fallback` is what it is when the parameter is absent, and setting it to the fallback
 * removes the parameter. Changes replace the history entry by default, so Back leaves the page, not the filter.
 */
export function useUrlState(
  key: string,
  fallback = "",
): [string, (next: string, opts?: { push?: boolean }) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const value = new URLSearchParams(search).get(key) ?? fallback;
  const set = useCallback(
    (next: string, opts?: { push?: boolean }) => {
      const params = new URLSearchParams(window.location.search);
      if (next === fallback || next === "") params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      navigate(qs ? `${location}?${qs}` : location, { replace: !opts?.push });
    },
    [key, fallback, location, navigate],
  );
  return [value, set];
}

/** The current month as `YYYY-MM`, from the `month` parameter, falling back to `fallback`. */
export const useMonthParam = (fallback: string) => useUrlState("month", fallback);
