import type { LogAction, LogChoice } from "@alimentation/core";
import { LOG_ACTIONS } from "@alimentation/core";

/** What the person has picked so far. Anything that is no longer a legal choice is replaced by a default. */
export interface Pick {
  action?: LogAction;
  serviceId?: string | null;
  itemId?: string | null;
}

/** The log form, worked out from the legal choices: what to offer, and what is selected. */
export interface FormView {
  /** The actions on offer, in the fixed order. */
  actions: LogAction[];
  action: LogAction | null;
  /** Leave and Supplier Off: the whole day, or one service. Only offered when there is a service to choose. */
  scopes: (string | null)[];
  showScope: boolean;
  /** Switch and Extra: the services they can be for. Only offered when there are two or more. */
  services: string[];
  showService: boolean;
  /** The selected scope or service; null is the whole day. */
  serviceId: string | null;
  items: string[];
  itemId: string | null;
  /** The most that can be asked for, for an Extra. */
  maxQty: number | null;
}

const NONE: FormView = {
  actions: [],
  action: null,
  scopes: [],
  showScope: false,
  services: [],
  showService: false,
  serviceId: null,
  items: [],
  itemId: null,
  maxQty: null,
};

/**
 * `choices` come from `logChoices`; `allowed` is what the reader's role may log. A form built only from this
 * cannot offer an entry the server would refuse for its shape, and a kitchen with one service never gets a
 * service control, because its only choice has no scope to pick.
 */
export function resolveForm(
  choices: readonly LogChoice[],
  allowed: readonly LogAction[],
  pick: Pick,
): FormView {
  const open = choices.filter((c) => allowed.includes(c.action));
  const actions = LOG_ACTIONS.filter((a) => open.some((c) => c.action === a));
  const action = pick.action && actions.includes(pick.action) ? pick.action : (actions[0] ?? null);
  if (action === null) return NONE;
  const mine = open.filter((c) => c.action === action);
  if (action === "Leave" || action === "Supplier Off") {
    const scopes = mine.map((c) => c.serviceId);
    const serviceId =
      pick.serviceId !== undefined && scopes.includes(pick.serviceId) ? pick.serviceId : null;
    return { ...NONE, actions, action, scopes, showScope: scopes.length > 1, serviceId };
  }
  const services = [
    ...new Set(mine.map((c) => c.serviceId).filter((s): s is string => s !== null)),
  ];
  const serviceId =
    pick.serviceId && services.includes(pick.serviceId) ? pick.serviceId : (services[0] ?? null);
  const here = mine.filter((c) => c.serviceId === serviceId);
  const items = here.flatMap((c) => ("itemId" in c ? [c.itemId] : []));
  const itemId = pick.itemId && items.includes(pick.itemId) ? pick.itemId : (items[0] ?? null);
  const extra = here.find((c) => c.action === "Extra" && c.itemId === itemId);
  return {
    ...NONE,
    actions,
    action,
    services,
    showService: services.length > 1,
    serviceId,
    items,
    itemId,
    maxQty: extra && extra.action === "Extra" ? extra.maxQty : null,
  };
}

/** Which actions a role may log from the form. The supplier marks a day the kitchen is off, and nothing else. */
export const allowedActions = (role: "admin" | "supplier" | "consumer"): LogAction[] =>
  role === "admin"
    ? [...LOG_ACTIONS]
    : role === "supplier"
      ? ["Supplier Off"]
      : LOG_ACTIONS.filter((a) => a !== "Supplier Off");

/** Several people's choices as one list: what any of them could be logged for, each once. */
export function unionChoices(lists: readonly (readonly LogChoice[])[]): LogChoice[] {
  const seen = new Set<string>();
  const out: LogChoice[] = [];
  for (const list of lists)
    for (const c of list) {
      const k = JSON.stringify(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  return out;
}
