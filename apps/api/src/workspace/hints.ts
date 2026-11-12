import { type EngineData, MSG, unpricedItems } from "@alimentation/core";

/**
 * What is not set up yet, in the kitchen's own terms, as the app shows it and a head office counts it. It names
 * what is missing: what the kitchen serves and the menu, the people, and (where the kitchen tracks money) exactly
 * the items that still have no price. They are listed in the order to do them, and the app shows the first.
 */
export function setupHints(data: EngineData, money: boolean): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const live = (x: { archivedOn: string | null }) =>
    x.archivedOn === null || x.archivedOn > data.today;
  const serves =
    data.services.some(live) && data.catalogue.some((i) => i.kind === "meal" && live(i));
  if (data.menus.length === 0)
    out.push({
      code: "menu",
      message: serves
        ? "Add the menu to start counting meals."
        : "Add what you serve, then the menu, to start counting meals.",
    });
  if (!data.people.some((x) => x.role === "consumer"))
    out.push({ code: "consumers", message: "Add the people you feed." });
  if (money) {
    const unpriced = unpricedItems(data);
    if (unpriced.length > 0)
      out.push({ code: "rate_card", message: MSG.unpricedItems(unpriced.map((i) => i.name)) });
    else if (data.rateCards.length === 0)
      out.push({ code: "rate_card", message: "Add prices to start billing." });
  }
  return out;
}
