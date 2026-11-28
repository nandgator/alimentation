import { createContext, type ReactNode, useContext } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

/**
 * The top of every page (NAV-01, NAV-02): the H1, which takes focus on a route change (`tabIndex={-1}`, found by
 * `[data-page-title]`), a line of description, the page's one primary action, and a tabs slot under it.
 * It sets the document title, so a page that renders a PageHeader has its own title.
 */
/**
 * Set by a hub (Setup, Books) around the page of its open tab. The hub's header has the H1 and the tabs, so a page
 * inside it is a section of the hub: its title is an H2, drawn exactly as Setup's sections are (`Section` in
 * setup/parts.tsx), with its description and actions beside it. Every tab of every hub then opens the same way.
 */
export const InsideHub = createContext(false);

export function PageHeader({
  title,
  description,
  actions,
  tabs,
  documentTitle,
  centred = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** The primary action, and at most one secondary. Sits right of the title on desktop, under it on a phone. */
  actions?: ReactNode;
  /** A `<Tabs>` list or other sub-navigation, drawn under the title. */
  tabs?: ReactNode;
  /** When the document title should say more than the H1 ("Payments · November 2026"). */
  documentTitle?: string;
  /** Title and description in the middle, as on a page of its own outside a kitchen (sign-in, join). */
  centred?: boolean;
  className?: string;
}) {
  const inHub = useContext(InsideHub);
  // In a hub the hub names the document ("Month end · Books").
  usePageTitle(inHub ? null : (documentTitle ?? title));
  if (inHub)
    return (
      <header className={cn("mb-4 flex flex-col gap-3", className)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? (
              <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
        {tabs}
      </header>
    );
  return (
    <header className={cn("mb-4 flex flex-col gap-3 md:mb-6", className)}>
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
          centred && "items-center text-center sm:flex-col sm:items-center",
        )}
      >
        <div className={cn("min-w-0", centred && "flex flex-col items-center")}>
          <h1
            tabIndex={-1}
            data-page-title
            // design: the plan sets the page title at 650 with a tracking of -0.01em (section 2)
            className="text-xl font-[650] tracking-[-0.01em] outline-none md:text-2xl"
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {tabs}
    </header>
  );
}
