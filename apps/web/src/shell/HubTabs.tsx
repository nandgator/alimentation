import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/app";
import { cn } from "@/lib/utils";
import { type HubKey, type Tab, tabsFor } from "../pages/workspace/sections.ts";

const HUB: Record<HubKey, { title: string; description: string }> = {
  setup: { title: "Setup", description: "What the kitchen serves, when, and by what rules." },
  books: {
    title: "Books",
    description: "Closing months, settling up, older months and the kitchen’s own records.",
  },
};

/**
 * The top of a hub (Setup, Books): the hub's title and line of description, then its tabs, then the tab's page. One
 * header for the whole hub, so moving between its tabs changes what is under the tabs and nothing above them.
 */
export function HubHeader({
  base,
  hub,
  active,
  money,
  priced,
}: {
  base: string;
  hub: HubKey;
  active: Tab;
  money: boolean;
  priced: boolean;
}) {
  const { title, description } = HUB[hub];
  const strip = useRef<HTMLElement>(null);
  // On a phone the strip scrolls: bring the active tab into view when the tab (or the hub) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active tab's key is what moves the strip
  useEffect(() => {
    const nav = strip.current;
    const here = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !here) return;
    nav.scrollLeft = Math.max(0, here.offsetLeft - (nav.clientWidth - here.offsetWidth) / 2);
  }, [active.key]);
  return (
    <PageHeader
      title={title}
      documentTitle={`${active.label} · ${title}`}
      description={description}
      tabs={
        <nav
          ref={strip}
          aria-label={`${title} sections`}
          className="-mx-4 overflow-x-auto border-b px-4 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] lg:-mx-6 lg:px-6"
        >
          <ul className="flex min-w-max gap-1 max-sm:pr-8">
            {tabsFor(hub, money, priced).map((t) => {
              const here = active.key === t.key;
              return (
                <li key={t.key}>
                  <Link
                    href={`${base}/${hub}${t.path}`}
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-11 items-center px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-fine:h-9",
                      here &&
                        "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
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
  );
}
