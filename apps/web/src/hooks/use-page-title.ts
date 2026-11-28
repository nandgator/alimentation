import { createContext, useContext, useEffect } from "react";

export const APP_NAME = "Alimentation";

/** The kitchen a page is in, given by the kitchen's shell, so that its pages are titled with it. */
export const KitchenTitle = createContext<string | undefined>(undefined);

/** The document title for a page: "Payments · Alimentation", or "Payments · North Mess · Alimentation" in a kitchen. Every route has its own (NAV-01). */
export function usePageTitle(title: string | undefined | null) {
  const kitchen = useContext(KitchenTitle);
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = [title, kitchen, APP_NAME].filter(Boolean).join(" · ");
    return () => {
      document.title = before;
    };
  }, [title, kitchen]);
}
