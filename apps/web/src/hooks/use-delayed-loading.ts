import { useEffect, useRef, useState } from "react";

/**
 * Whether to show a skeleton for a load that is in progress (NAV-08): only after `delay` ms, so a quick load never
 * flashes one, and once shown for at least `minimum` ms, so it never flickers away.
 */
export function useDelayedLoading(loading: boolean, delay = 150, minimum = 300): boolean {
  const [show, setShow] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => {
        shownAt.current = Date.now();
        setShow(true);
      }, delay);
      return () => clearTimeout(t);
    }
    if (!show) return;
    const left = Math.max(0, minimum - (Date.now() - shownAt.current));
    const t = setTimeout(() => setShow(false), left);
    return () => clearTimeout(t);
  }, [loading, show, delay, minimum]);
  return show;
}
