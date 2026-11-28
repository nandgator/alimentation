import type { ReactNode } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

/**
 * The top of every page (NAV-01, NAV-02): the H1, which takes focus on a route change (`tabIndex={-1}`, found by
 * `[data-page-title]`), a line of description, the page's one primary action, and a tabs slot under it.
 * It sets the document title, so a page that renders a PageHeader has its own title.
 */
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
  usePageTitle(documentTitle ?? title);
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
