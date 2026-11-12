/**
 * What a new kitchen can start from. A starter is plain data: services, items and a week of meals. It is
 * applied with the same calls a person would make by hand (rename the first service, add services, add items,
 * add a menu), so the server and the engine know nothing of any one kitchen's food. A starter has no prices, since
 * what food costs is the kitchen's own to say: a kitchen that tracks money is asked to price what it serves.
 */

export interface StarterItem {
  /** Only a name in this starter, to say which meal is served where. */
  key: string;
  kind: "meal" | "addon";
  name: string;
  unit: string;
  maxQty?: number;
}

export interface StarterService {
  name: string;
  /** The meal served on each working day, by item key. */
  meal: string;
  /** The other items this service offers, by item key. */
  also: string[];
}

export interface Starter {
  id: "home" | "mess" | "blank";
  title: string;
  about: string;
  services: StarterService[];
  items: StarterItem[];
}

export const STARTERS: readonly Starter[] = [
  {
    id: "home",
    title: "Home lunch",
    about: "One lunch a day, a veg or a non-veg plate, with chapati and bhakri as extras.",
    services: [{ name: "Lunch", meal: "veg", also: ["nonveg", "chapati", "bhakri"] }],
    items: [
      { key: "veg", kind: "meal", name: "Veg", unit: "plate" },
      { key: "nonveg", kind: "meal", name: "Non Veg", unit: "plate" },
      { key: "chapati", kind: "addon", name: "Chapati", unit: "piece" },
      { key: "bhakri", kind: "addon", name: "Bhakri", unit: "piece" },
    ],
  },
  {
    id: "mess",
    title: "Mess",
    about: "Breakfast, lunch and dinner, each its own service, with curd as an extra.",
    services: [
      { name: "Breakfast", meal: "breakfast", also: [] },
      { name: "Lunch", meal: "thali", also: ["khichdi", "curd"] },
      { name: "Dinner", meal: "thali", also: ["khichdi", "curd"] },
    ],
    items: [
      { key: "breakfast", kind: "meal", name: "Breakfast", unit: "plate" },
      { key: "thali", kind: "meal", name: "Thali", unit: "plate" },
      { key: "khichdi", kind: "meal", name: "Khichdi", unit: "plate" },
      { key: "curd", kind: "addon", name: "Curd", unit: "cup" },
    ],
  },
  {
    id: "blank",
    title: "Blank",
    about: "Nothing yet. Add your own services and items under Catalogue.",
    services: [],
    items: [],
  },
];

/** The ordinary calls that set a starter up, as the page makes them. */
export interface StarterApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch(path: string, body: unknown): Promise<unknown>;
}

interface Kitchen {
  today: string;
  policy: { workingDays: number[] };
  /** The services the kitchen has. A kitchen made through the API starts with none. */
  services: { id: string }[];
}

/**
 * Sets a kitchen up from a starter, through `base` (`/api/w/<slug>`). The starter's services are added; if the
 * kitchen already has one, the first of them renames it instead of adding a second. A blank starter makes no
 * call at all.
 */
export async function applyStarter(api: StarterApi, base: string, starter: Starter): Promise<void> {
  const [first, ...more] = starter.services;
  if (!first) return;
  const boot = await api.get<Kitchen>(`${base}/bootstrap`);
  const existing = boot.services[0]?.id;
  let firstId = existing;
  if (existing) await api.patch(`${base}/services/${existing}`, { name: first.name });
  else firstId = (await api.post<{ id: string }>(`${base}/services`, { name: first.name })).id;
  const serviceIds = [firstId as string];
  for (const sv of more) {
    const made = await api.post<{ id: string }>(`${base}/services`, { name: sv.name });
    serviceIds.push(made.id);
  }
  const itemIds = new Map<string, string>();
  for (const it of starter.items) {
    const made = await api.post<{ id: string }>(`${base}/catalogue`, {
      kind: it.kind,
      name: it.name,
      unit: it.unit,
      maxQty: it.maxQty ?? 20,
    });
    itemIds.set(it.key, made.id);
  }
  const id = (key: string) => {
    const found = itemIds.get(key);
    if (!found) throw new Error(`The starter names an item it does not have: ${key}.`);
    return found;
  };
  const days: Record<string, Record<string, string>> = {};
  const offered: Record<string, string[]> = {};
  starter.services.forEach((sv, i) => {
    const serviceId = serviceIds[i] as string;
    days[serviceId] = Object.fromEntries(
      boot.policy.workingDays.map((d) => [String(d), id(sv.meal)]),
    );
    offered[serviceId] = [...new Set([sv.meal, ...sv.also])].map(id);
  });
  await api.post(`${base}/menus`, { effectiveFrom: boot.today, days, offered, note: null });
}
