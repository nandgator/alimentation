import { useSyncExternalStore } from "react";

/** Whether a media query matches, live. Renders false where there is no `matchMedia`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}

/** Below 768px, where dialogs become sheets and tables become lists. */
export const useIsNarrow = () => useMediaQuery("(max-width: 767px)");
