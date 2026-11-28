import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { type HubKey, type Tab, tabsFor } from "../pages/workspace/sections.ts";

/**
 * The row of tabs above a hub's screen (Setup, Books). A stand-in the owners of the hubs replace with the tabs
 * of their own page header (the plan's `PageHeader` has a slot for them); until then every tab is one link and the
 * page under it is the screen as it was.
 */
// TODO(WP7, WP8): drop this when the hub pages carry their own tabs.
export function HubTabs({
  base,
  hub,
  active,
  money,
  priced,
}: {
  base: string;
  hub: HubKey;
  active: Tab | undefined;
  money: boolean;
  priced: boolean;
}) {
  return (
    <nav
      aria-label={hub === "setup" ? "Setup" : "Books"}
      className="-mx-4 mb-4 overflow-x-auto border-b px-4 lg:-mx-6 lg:px-6"
    >
      <ul className="flex min-w-max gap-1">
        {tabsFor(hub, money, priced).map((t) => {
          const here = active?.key === t.key;
          return (
            <li key={t.key}>
              <Link
                href={`${base}/${hub}${t.path}`}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-11 items-center px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-fine:h-9",
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
  );
}
