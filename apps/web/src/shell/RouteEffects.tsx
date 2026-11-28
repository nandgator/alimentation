import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation } from "wouter";

/** The last address a route change was handled for, kept for the life of the page so that a shell that mounts again does not take it for a first visit. */
let handled: string | null = null;
/** Set by the browser's Back and Forward, which keep the scroll position they had instead of going to the top. */
let popped = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = true));

/** `{Page} · {Kitchen} · Alimentation`; a page outside a kitchen drops the kitchen part. */
export const documentTitle = (page: string, kitchen?: string) =>
  [page, kitchen, "Alimentation"].filter(Boolean).join(" · ");

/** The first heading of the page region, given the means to take focus. */
function pageHeading(): HTMLElement | null {
  const h = document.querySelector<HTMLElement>("main h1");
  if (h && !h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  return h;
}

/** Whether a person has moved focus somewhere of their own in the page since the route changed. */
const focusIsTheirs = () => {
  const a = document.activeElement;
  return (
    a instanceof HTMLElement &&
    a !== document.body &&
    (a.closest("[role=dialog]") !== null ||
      (a.closest("main") !== null && a.tagName !== "H1" && a.id !== "main"))
  );
};

/**
 * What happens on every change of route, for every page of the app:
 *  1. the document title is `{Page} · {Kitchen} · Alimentation`;
 *  2. the page scrolls to the top (Back and Forward keep their place) and focus goes to its H1, as soon as
 *     the page has drawn one, unless the person has put focus on something of their own by then;
 *  3. the title is announced in a polite live region.
 * (The fade is the router's, and the progress bar the shell's.) A `title` of null leaves the title and focus
 * alone, for the home page, which looks after itself.
 */
export function RouteEffects({ title }: { title: string | null }) {
  const [location] = useLocation();
  const [announced, setAnnounced] = useState("");

  useLayoutEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs on a change of address, not of title
  useEffect(() => {
    const first = handled === null;
    const same = handled === location;
    handled = location;
    if (first || same) return;
    const back = popped;
    popped = false;
    if (!back) window.scrollTo(0, 0);
    if (title === null) return;
    setAnnounced(title);

    // The page may draw its heading a moment later, once its data is here: wait for it, for a few seconds.
    let done = false;
    const take = () => {
      if (done) return;
      const h = pageHeading();
      if (!h) return;
      done = true;
      observer.disconnect();
      if (!focusIsTheirs()) h.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(take);
    const root = document.querySelector("main") ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    const frame = requestAnimationFrame(take);
    const give = setTimeout(() => {
      done = true;
      observer.disconnect();
    }, 4000);
    return () => {
      done = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(give);
    };
  }, [location]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announced}
    </div>
  );
}
