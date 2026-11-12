import {
  buildMealStatements,
  buildStatements,
  closeSnapshot,
  consumers,
  dueAutoCloses,
  type EngineData,
  ledgerMonth,
  prepare,
} from "../../src/engine.ts";
import { DEFAULT_POLICY, type Policy, withoutMoneyRules } from "../../src/policy.ts";
import type { LogEntry } from "../../src/types.ts";
import { homeKitchenSeed } from "../seed.ts";
import { digestOf, errorCode, rowString } from "./canon.ts";
import type {
  FoodKey,
  GoldenExpected,
  GoldenLog,
  GoldenPolicy,
  GoldenRow,
  GoldenScenario,
  MealKey,
} from "./scenarios.ts";

const seed = homeKitchenSeed();
const ITEM: Record<FoodKey, string> = {
  veg: seed.ids.veg,
  nonVeg: seed.ids.nonVeg,
  chapati: seed.ids.chapati,
  bhakri: seed.ids.bhakri,
};
const mealKey = (id: string | null): MealKey | null =>
  id === null ? null : id === ITEM.veg ? "veg" : "nonVeg";

function policyOf(p: GoldenPolicy, moneyEnabled: boolean): { effectiveFrom: string; doc: Policy } {
  const monthClose: Policy["monthClose"] =
    p.monthClose.mode === "off"
      ? { mode: "off" }
      : p.monthClose.mode === "manual"
        ? { mode: "manual", afterClose: "flag" }
        : { mode: "auto", afterDays: p.monthClose.afterDays, afterClose: "flag" };
  const doc: Policy = {
    ...DEFAULT_POLICY,
    workingDays: p.workingDays,
    holidays: { count: p.holidaysCount },
    monthlyFee: p.feeMinMeals === null ? null : { minDays: p.feeMinMeals },
    leave: { chargeBps: p.leaveChargeBps },
    monthClose,
  };
  return { effectiveFrom: p.effectiveFrom, doc: moneyEnabled ? doc : withoutMoneyRules(doc) };
}

function entryOf(l: GoldenLog): Pick<LogEntry, "action" | "serviceId" | "itemId" | "qty"> {
  switch (l.kind) {
    case "leave":
      return { action: "Leave", serviceId: null, itemId: null, qty: null };
    case "off":
      return { action: "Supplier Off", serviceId: null, itemId: null, qty: null };
    case "switch":
      return { action: "Switch", serviceId: seed.ids.lunch, itemId: ITEM[l.meal], qty: null };
    case "extra":
      return { action: "Extra", serviceId: seed.ids.lunch, itemId: ITEM[l.addOn], qty: l.qty };
  }
}

/** The scenario as this engine takes it: the seed's one service and four items stand for the neutral keys. */
function dataOf(s: GoldenScenario): EngineData {
  const lunch = seed.ids.lunch;
  const offered = [ITEM.veg, ITEM.nonVeg, ITEM.chapati, ITEM.bhakri];
  return {
    today: s.today,
    moneyEnabled: s.moneyEnabled,
    policies: s.policies.map((p) => policyOf(p, s.moneyEnabled)),
    catalogue: seed.catalogue,
    services: seed.services,
    enrolments: s.people
      .filter((p) => p.role === "consumer" && p.activeFrom !== null)
      .map((p) => ({
        personId: p.id,
        serviceId: lunch,
        activeFrom: p.activeFrom as string,
        activeTo: null,
      })),
    menus: s.menus.map((m, i) => ({
      id: `menu-${i}`,
      effectiveFrom: m.effectiveFrom,
      days: {
        [lunch]: Object.fromEntries(Object.entries(m.days).map(([w, k]) => [w, ITEM[k]])),
      },
      offered: { [lunch]: offered },
      note: null,
    })),
    rateCards: s.cards.map((c, i) => ({
      id: `card-${i}`,
      effectiveFrom: c.effectiveFrom,
      prices: (Object.keys(ITEM) as FoodKey[]).map((k) => ({
        itemId: ITEM[k],
        serviceId: null,
        amount: c.prices[k],
      })),
      monthlyFee: c.fee,
      note: null,
    })),
    holidays: s.holidays.map((h, i) => ({
      id: `h-${i}`,
      name: `Holiday ${h.date}`,
      date: h.date,
      location: null,
      confirmed: h.confirmed,
    })),
    people: s.people.map((p) => ({ name: p.id, ...p })),
    log: s.log.map((l) => ({
      id: l.id,
      date: l.date,
      personId: l.personId,
      allConsumers: l.all,
      ...entryOf(l),
      note: null,
      loggedBy: "admin",
      loggedAt: l.loggedAt,
    })),
    claims: s.claims.map((c) => ({
      id: c.id,
      consumerId: c.consumerId,
      paidAt: "2026-10-25",
      forMonth: c.forMonth,
      amount: c.amount,
      method: "UPI" as const,
      refNote: null,
      createdAt: "2026-10-25T08:00:00Z",
    })),
    decisions: s.claims
      .filter((c) => c.decision !== null)
      .map((c) => ({
        claimId: c.id,
        decision: c.decision as "Confirmed" | "Disputed",
        note: null,
        decidedBy: "supplier",
        decidedAt: "2026-10-26T08:00:00Z",
        voided: c.voided,
      })),
    settlements: s.settlements.map((t) => ({
      id: t.id,
      date: "2026-11-01",
      consumerId: t.consumerId,
      forMonth: t.forMonth,
      type: t.type,
      amount: t.amount,
      note: null,
      recordedBy: "admin",
      createdAt: "2026-11-01T08:00:00Z",
    })),
    closes: s.closes.map((c) => ({
      forMonth: c.month,
      consumerId: c.consumerId,
      meals: c.meals,
      billed: c.billed,
      closedOn: "2026-11-01",
      closedBy: "admin",
    })),
  };
}

const n = (x: number | undefined) => x ?? 0;

export function runScenario(s: GoldenScenario): GoldenExpected {
  const p = prepare(dataOf(s));
  const people = consumers(p);
  const out: GoldenExpected = {
    statements: [],
    statementErrors: [],
    mealStatements: [],
    ledgers: [],
    dueClosesError: null,
    dueCloses: [],
    snapshots: [],
  };

  for (const person of people) {
    for (const month of s.months) {
      if (s.moneyEnabled) {
        try {
          const [st] = buildStatements(p, [person.id], [month]);
          if (!st) throw new Error("no statement");
          out.statements.push({
            personId: st.personId,
            month: st.month,
            basis: st.basis,
            meals: st.counts.meals,
            leave: st.counts.leave,
            veg: n(st.counts.items[ITEM.veg]),
            nonVeg: n(st.counts.items[ITEM.nonVeg]),
            chapati: n(st.counts.addOns[ITEM.chapati]),
            bhakri: n(st.counts.addOns[ITEM.bhakri]),
            mealsAmount: st.mealsAmount,
            addOnAmount: st.addOnAmount,
            leaveAmount: st.leaveAmount,
            feeAmount: st.feeAmount,
            liveTotal: st.liveTotal,
            actualToDate: st.actualToDate,
            closed: st.closed,
            billed: st.billed,
            changedAfterClose: st.changedAfterClose,
            paid: st.paid,
            claimedPending: st.claimedPending,
            balance: st.balance,
            openQueries: st.openQueries,
            status: st.status,
            earlierUnpaid: st.earlierUnpaid,
          });
        } catch (e) {
          out.statementErrors.push({ personId: person.id, month, error: errorCode(e) });
        }
      }
      const [ms] = buildMealStatements(p, [person.id], [month]);
      if (!ms) throw new Error("no meal statement");
      out.mealStatements.push({
        personId: ms.personId,
        month: ms.month,
        basis: ms.basis,
        meals: ms.counts.meals,
        leave: ms.counts.leave,
        veg: n(ms.counts.items[ITEM.veg]),
        nonVeg: n(ms.counts.items[ITEM.nonVeg]),
        chapati: n(ms.counts.addOns[ITEM.chapati]),
        bhakri: n(ms.counts.addOns[ITEM.bhakri]),
        closed: ms.closed,
      });

      try {
        const rows: GoldenRow[] = ledgerMonth(p, person, month).map((d) => ({
          date: d.date,
          status: d.status,
          meal: mealKey(d.mealId),
          chapati: n(d.addOns.find((a) => a.itemId === ITEM.chapati)?.qty),
          bhakri: n(d.addOns.find((a) => a.itemId === ITEM.bhakri)?.qty),
          mealPrice: d.mealPrice,
          addOnAmount: d.addOnAmount,
          leaveAmount: d.leaveAmount,
          total: d.rowTotal,
          basis: d.basis,
          holidayName: d.holidayName,
        }));
        const lines = rows.map(rowString);
        out.ledgers.push({
          personId: person.id,
          month,
          error: null,
          rows: rows.length,
          total: s.moneyEnabled
            ? rows.reduce((a, r) => a + r.total, 0)
            : rows.filter((r) => r.status === "Meal").length,
          digest: digestOf(lines),
          ...(s.fullLedger ? { full: lines } : {}),
        });
      } catch (e) {
        out.ledgers.push({
          personId: person.id,
          month,
          error: errorCode(e),
          rows: 0,
          total: 0,
          digest: "",
        });
      }

      try {
        const snap = closeSnapshot(p, person.id, month);
        out.snapshots.push({ consumerId: person.id, month, error: null, ...snap });
      } catch (e) {
        out.snapshots.push({
          consumerId: person.id,
          month,
          error: errorCode(e),
          meals: 0,
          billed: null,
        });
      }
    }
  }
  try {
    out.dueCloses = dueAutoCloses(p).map((d) => ({ ...d, error: null }));
  } catch (e) {
    out.dueClosesError = errorCode(e);
  }
  return out;
}
