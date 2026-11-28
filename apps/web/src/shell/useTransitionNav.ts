import { flushSync } from "react-dom";

type Navigate = (to: string, opts?: Record<string, unknown>) => void;

/**
 * Wraps every navigation of the router (`aroundNav`): where the browser can, the new page is shown inside a
 * View Transition, which the stylesheet turns into a short fade of the page region alone. A change of search
 * only, a browser without the API and a person who asks for less motion all get the plain, instant swap.
 */
export function aroundNav(navigate: Navigate, to: string, opts?: Record<string, unknown>): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const samePath = to.split(/[?#]/)[0] === window.location.pathname;
  if (
    !doc.startViewTransition ||
    samePath ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    navigate(to, opts);
    return;
  }
  doc.startViewTransition(() => {
    flushSync(() => navigate(to, opts));
  });
}
