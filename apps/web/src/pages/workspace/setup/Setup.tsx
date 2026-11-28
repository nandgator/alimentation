import { Link, useParams } from "wouter";
import { NotAvailable, PageHeader } from "@/components/app";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../context.tsx";
import { tabsFor } from "../sections.ts";
import { HolidaysTab } from "./tabs/Holidays.tsx";
import { ItemsTab } from "./tabs/Items.tsx";
import { MenuTab } from "./tabs/Menu.tsx";
import { PricesTab } from "./tabs/Prices.tsx";
import { RulesTab } from "./tabs/Rules.tsx";

const BODY: Record<string, () => React.JSX.Element> = {
  items: ItemsTab,
  menu: MenuTab,
  prices: PricesTab,
  rules: RulesTab,
  holidays: HolidaysTab,
};

/**
 * The Setup hub (`/w/:slug/setup/:tab`): one page with its own title and the tabs of what the kitchen serves, the
 * menu, the prices (only where money is tracked), the rules and the holidays. The tab is the address, so a reload
 * or a shared link lands on the same one. `tab` names one when the address does not (the shell's old wiring).
 */
export function SetupHub({ tab: given }: { tab?: string }) {
  const ws = useWorkspace();
  const params = useParams<{ tab?: string }>();
  const tabs = tabsFor("setup", ws.money, Boolean(ws.boot.rateCard));
  const active = tabs.find((t) => (given ? t.key === given : t.path === `/${params.tab ?? ""}`));
  const Body = active ? BODY[active.key] : undefined;
  if (!active || !Body)
    return (
      <NotAvailable title="Page not found" backTo={`${ws.base}/setup`} backLabel="Go to Setup">
        This kitchen has no such tab in Setup.
      </NotAvailable>
    );
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Setup"
        documentTitle={`${active.label} · Setup`}
        description="What the kitchen serves, when, and by what rules."
        tabs={
          <nav
            aria-label="Setup sections"
            className="-mx-4 overflow-x-auto border-b px-4 lg:-mx-6 lg:px-6"
          >
            <ul className="flex min-w-max gap-1">
              {tabs.map((t) => {
                const here = t.key === active.key;
                return (
                  <li key={t.key}>
                    <Link
                      href={`${ws.base}/setup${t.path}`}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "relative inline-flex h-11 items-center px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-fine:h-9",
                        here &&
                          "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-highlight",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        }
      />
      <Body />
    </div>
  );
}
