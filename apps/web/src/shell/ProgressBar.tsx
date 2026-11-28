import { useEffect, useState } from "react";

/**
 * A 2px bar under the top edge, for when a page or its data is on its way. It shows only after 150ms, so a
 * quick change never flashes it, and then stays at least 300ms. Under reduced motion it is a still bar.
 */
export function ProgressBar({ active }: { active: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setShown(true), 150);
      return () => clearTimeout(t);
    }
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 300);
    return () => clearTimeout(t);
  }, [active, shown]);
  if (!shown && !active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-busy={active}
      className="pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5 overflow-hidden"
      hidden={!shown}
    >
      <div className="h-full w-2/5 bg-primary motion-safe:animate-[shell-progress_1.1s_var(--ease-in-out)_infinite]" />
    </div>
  );
}

/** For a Suspense fallback: the bar, with nothing else on the page. */
export const PendingBar = () => <ProgressBar active />;
