import { rupees } from "../src/money.ts";
import { DEFAULT_POLICY, type PolicyVersion } from "../src/policy.ts";
import type {
  CatalogueItem,
  Enrolment,
  Holiday,
  LogEntry,
  MenuVersion,
  Person,
  PriceLine,
  RateCard,
  Service,
} from "../src/types.ts";

/**
 * The original home kitchen, as data: the worked example of SPEC section 11 and the first starter. Core and API
 * tests share it so they agree on what October 2026 comes to (Jovial 3,260, Smruti 3,030, together 6,290).
 * Nothing in the engine knows these names; they are one kitchen's catalogue like any other.
 */
export interface HomeKitchenSeed {
  ids: {
    lunch: string;
    veg: string;
    nonVeg: string;
    chapati: string;
    bhakri: string;
  };
  services: Service[];
  catalogue: CatalogueItem[];
  /** From 2026-04-01: Mon Veg, Tue Veg, Wed Non Veg, Thu Veg, Fri Non Veg; all four items offered. */
  menu: MenuVersion;
  /** From 2026-04-01: Veg 150, Non Veg 170, Chapati 15, Bhakri 30, monthly fee 40. */
  cardApr: RateCard;
  /** From 2026-11-01: Veg 160 and Non Veg 180, the rest as before. */
  cardNov: RateCard;
  /** The default rules with the monthly fee from one day with a meal. */
  policy: PolicyVersion;
  people: { admin: Person; maple: Person; jovial: Person; smruti: Person };
  enrolments: Enrolment[];
  holidays: Holiday[];
  /** Jovial: two Bhakri on 2026-10-01. Smruti: leave, whole day, on 2026-10-16. */
  log: LogEntry[];
}

const price = (itemId: string, amount: number, serviceId: string | null = null): PriceLine => ({
  itemId,
  serviceId,
  amount,
});

export function homeKitchenSeed(): HomeKitchenSeed {
  const ids = {
    lunch: "svc-lunch",
    veg: "item-veg",
    nonVeg: "item-non-veg",
    chapati: "item-chapati",
    bhakri: "item-bhakri",
  };
  const catalogue: CatalogueItem[] = [
    { id: ids.veg, kind: "meal", name: "Veg", unit: "plate", maxQty: 20, archivedOn: null },
    { id: ids.nonVeg, kind: "meal", name: "Non Veg", unit: "plate", maxQty: 20, archivedOn: null },
    {
      id: ids.chapati,
      kind: "addon",
      name: "Chapati",
      unit: "piece",
      maxQty: 20,
      archivedOn: null,
    },
    { id: ids.bhakri, kind: "addon", name: "Bhakri", unit: "piece", maxQty: 20, archivedOn: null },
  ];
  const menu: MenuVersion = {
    id: "menu-apr",
    effectiveFrom: "2026-04-01",
    days: {
      [ids.lunch]: { 1: ids.veg, 2: ids.veg, 3: ids.nonVeg, 4: ids.veg, 5: ids.nonVeg },
    },
    offered: { [ids.lunch]: [ids.veg, ids.nonVeg, ids.chapati, ids.bhakri] },
    note: null,
  };
  const cardApr: RateCard = {
    id: "card-apr",
    effectiveFrom: "2026-04-01",
    prices: [
      price(ids.veg, rupees(150)),
      price(ids.nonVeg, rupees(170)),
      price(ids.chapati, rupees(15)),
      price(ids.bhakri, rupees(30)),
    ],
    monthlyFee: rupees(40),
    note: null,
  };
  const cardNov: RateCard = {
    ...cardApr,
    id: "card-nov",
    effectiveFrom: "2026-11-01",
    prices: [
      price(ids.veg, rupees(160)),
      price(ids.nonVeg, rupees(180)),
      price(ids.chapati, rupees(15)),
      price(ids.bhakri, rupees(30)),
    ],
  };
  const person = (id: string, name: string, role: Person["role"], from: string | null): Person => ({
    id,
    name,
    role,
    activeFrom: from,
    activeTo: null,
  });
  const people = {
    admin: person("admin", "Owner", "admin", null),
    maple: person("maple", "Maple", "supplier", null),
    jovial: person("jovial", "Jovial", "consumer", "2026-10-01"),
    smruti: person("smruti", "Smruti", "consumer", "2026-10-01"),
  };
  const h = (id: string, name: string, date: string, confirmed = true): Holiday => ({
    id,
    name,
    date,
    location: "Mumbai",
    confirmed,
  });
  return {
    ids,
    services: [{ id: ids.lunch, name: "Lunch", position: 0, archivedOn: null }],
    catalogue,
    menu,
    cardApr,
    cardNov,
    policy: {
      effectiveFrom: "2020-01-01",
      doc: { ...DEFAULT_POLICY, monthlyFee: { minDays: 1 } },
    },
    people,
    enrolments: [people.jovial, people.smruti].map((c) => ({
      personId: c.id,
      serviceId: ids.lunch,
      activeFrom: "2026-10-01",
      activeTo: null,
    })),
    holidays: [
      h("h1", "Maharashtra Day", "2026-05-01"),
      h("h2", "Holiday", "2026-09-14"),
      h("h3", "Gandhi Jayanti", "2026-10-02"),
      h("h4", "Holiday", "2026-10-20"),
      h("h5", "Holiday", "2026-11-09"),
      h("h6", "Holiday", "2026-11-10"),
      h("h7", "Holiday", "2026-11-11"),
      h("h8", "Tentative", "2026-11-12", false),
      h("h9", "Tentative", "2026-11-13", false),
      h("h10", "Christmas", "2026-12-25"),
    ],
    log: [
      {
        id: "seed-1",
        date: "2026-10-01",
        personId: "jovial",
        allConsumers: false,
        action: "Extra",
        serviceId: ids.lunch,
        itemId: ids.bhakri,
        qty: 2,
        note: null,
        loggedBy: "maple",
        loggedAt: "2026-09-30T10:01:00Z",
      },
      {
        id: "seed-2",
        date: "2026-10-16",
        personId: "smruti",
        allConsumers: false,
        action: "Leave",
        serviceId: null,
        itemId: null,
        qty: null,
        note: "WFH",
        loggedBy: "smruti",
        loggedAt: "2026-09-30T10:02:00Z",
      },
    ],
  };
}
