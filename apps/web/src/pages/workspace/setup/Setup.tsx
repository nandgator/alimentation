import { useParams } from "wouter";
import { NotAvailable } from "@/components/app";
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
 * The page of one Setup tab (`/w/:slug/setup/:tab`): what the kitchen serves, the menu, the prices (only where money
 * is tracked), the rules or the holidays. The hub's title and tabs above it are the shell's (`HubHeader`), the same
 * for Setup as for Books. `tab` names the tab when the address does not.
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
  return <Body />;
}
