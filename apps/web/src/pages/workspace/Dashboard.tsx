import {
  addMonths,
  isMoneyStatement,
  type MealStatementDto,
  STATUS_LABEL,
  type StatementDto,
} from "@alimentation/core";
import { useMemo, useState } from "react";
import { getJson } from "../../api.ts";
import { priceWords, shownItems } from "../../catalogue.ts";
import { BarChart } from "../../components/Chart.tsx";
import {
  Chip,
  MonthPicker,
  PageHead,
  Problem,
  Spinner,
  Tile,
  useLoad,
} from "../../components/ui.tsx";
import { date, money, month as monthLabel } from "../../format.ts";
import { billingLead, bodyProblem } from "../../setup.ts";
import { BillLines } from "./BillLines.tsx";
import { useWorkspace } from "./context.tsx";

const TONE: Record<string, "good" | "warn" | "bad" | undefined> = {
  SETTLED: "good",
  DUE: "warn",
  PART_PAID: "warn",
  AWAITING_CONFIRMATION: "warn",
  QUERY_OPEN: "bad",
  CHANGED_AFTER_CLOSE: "bad",
};

const sum = (xs: StatementDto[], f: (s: StatementDto) => number) =>
  xs.reduce((a, s) => a + f(s), 0);

/** The six months ending with the selected one, never before the first month with anything to count. */
function useRange(selected: string) {
  const { boot } = useWorkspace();
  return useMemo(() => {
    const first = boot.months[0] ?? boot.currentMonth;
    const out: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(selected as never, -i);
      if (m >= first) out.push(m);
    }
    return out.length ? out : [selected];
  }, [boot.months, boot.currentMonth, selected]);
}

const total = (xs: MealStatementDto[], f: (s: MealStatementDto) => number) =>
  xs.reduce((a, s) => a + f(s), 0);

/** What a kitchen without money has for a dashboard: how many meals, leaves and extras, and which months are locked. */
function MealsDashboard() {
  const ws = useWorkspace();
  const { boot } = ws;
  const [selected, setSelected] = useState<string>(boot.currentMonth);
  const range = useRange(selected);
  const stm = useLoad(
    () =>
      boot.menu
        ? getJson<MealStatementDto[]>(`${ws.api}/statements?months=${range.join(",")}`)
        : Promise.resolve([] as MealStatementDto[]),
    [ws.api, range.join(","), boot.menu?.id],
  );
  const all = stm.data ?? [];
  const mine = all.filter((s) => s.month === selected);
  const single = ws.role === "consumer";
  const projected = mine.length > 0 && mine.every((s) => s.basis === "Projected");
  // The kitchen's own food: a column and a tile for each meal and each add-on it has served.
  const meals = shownItems(
    boot,
    "meal",
    mine.map((s) => s.counts.items),
    boot.today,
  );
  const addOns = shownItems(
    boot,
    "addon",
    mine.map((s) => s.counts.addOns),
    boot.today,
  );
  const extrasOf = (s: MealStatementDto) =>
    Object.values(s.counts.addOns).reduce((a, n) => a + n, 0);
  const series = [...new Set(all.map((s) => s.personId))].map((id) => ({
    name: single ? "Meals" : ws.nameOf(id),
    values: range.map(
      (m) => all.find((s) => s.personId === id && s.month === m)?.counts.meals ?? null,
    ),
  }));
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Dashboard"
        lead={
          single
            ? `Hello, ${boot.me.name}. Your meals, leave and extras.`
            : "Who ate, who was on leave, and the extras."
        }
        actions={
          <>
            <Chip tone={projected ? undefined : "good"}>{projected ? "Projected" : "Actual"}</Chip>
            <MonthPicker
              months={boot.months.length ? boot.months : [boot.currentMonth]}
              value={selected}
              onChange={setSelected}
              current={boot.currentMonth}
            />
          </>
        }
      />
      {boot.organisation ? (
        <p className="muted small">
          This kitchen shares its totals (how many people and how many meals, with no names) with{" "}
          {boot.organisation.name}.
        </p>
      ) : null}
      <Problem error={bodyProblem(stm.error, boot.setup)} />
      {stm.loading && !stm.data ? <Spinner /> : null}
      {mine.length > 0 ? (
        <div className="tilegroups">
          <div className="tiles lead">
            <Tile
              lead
              label="Meals"
              value={total(mine, (s) => s.counts.meals)}
              projected={projected}
            />
            <Tile lead label="Leave days" value={total(mine, (s) => s.counts.leave) || "-"} />
            <Tile lead label="Extras" value={total(mine, extrasOf) || "-"} />
          </div>
          {meals.length + addOns.length > 0 ? (
            <div className="tiles">
              {meals.map((i) => (
                <Tile
                  key={i.id}
                  label={i.name}
                  value={total(mine, (s) => s.counts.items[i.id] ?? 0)}
                />
              ))}
              {addOns.map((i) => (
                <Tile
                  key={i.id}
                  label={i.name}
                  value={total(mine, (s) => s.counts.addOns[i.id] ?? 0) || "-"}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : !stm.loading && boot.menu ? (
        <p className="muted">Nothing to show for {monthLabel(selected)} yet.</p>
      ) : null}
      {!single && mine.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="r">Meals</th>
                {meals.map((i) => (
                  <th key={i.id} className="r">
                    {i.name}
                  </th>
                ))}
                <th className="r">Leave</th>
                {addOns.map((i) => (
                  <th key={i.id} className="r">
                    {i.name}
                  </th>
                ))}
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.personId} className={s.basis === "Projected" ? "projected" : ""}>
                  <td>{s.name}</td>
                  <td className="r">{s.counts.meals}</td>
                  {meals.map((i) => (
                    <td key={i.id} className="r">
                      {s.counts.items[i.id] ?? 0}
                    </td>
                  ))}
                  <td className="r">{s.counts.leave || "-"}</td>
                  {addOns.map((i) => (
                    <td key={i.id} className="r">
                      {s.counts.addOns[i.id] || "-"}
                    </td>
                  ))}
                  <td>
                    <Chip tone={s.closed ? "good" : undefined}>{s.closed ? "Locked" : "Open"}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {series.length > 0 ? (
        <section className="card stack" aria-label="Meals each month">
          <h2>Meals each month</h2>
          <BarChart
            counts
            categories={range}
            projected={range.map((m) =>
              all.filter((s) => s.month === m).every((s) => s.basis === "Projected"),
            )}
            series={series}
            label={
              single
                ? "Your meals in each of the last months"
                : "Meals for each person in each of the last months"
            }
          />
        </section>
      ) : null}
    </div>
  );
}

export function Dashboard() {
  const ws = useWorkspace();
  return ws.money ? <MoneyDashboard /> : <MealsDashboard />;
}

function MoneyDashboard() {
  const ws = useWorkspace();
  const { boot } = ws;
  const [selected, setSelected] = useState<string>(boot.currentMonth);
  // Six months ending with the selected one, never before the first month with anything to bill.
  const range = useRange(selected);

  const stm = useLoad(
    () =>
      boot.rateCard
        ? getJson<(StatementDto | MealStatementDto)[]>(
            `${ws.api}/statements?months=${range.join(",")}`,
          ).then((r) => r.filter(isMoneyStatement))
        : Promise.resolve([] as StatementDto[]),
    [ws.api, range.join(","), boot.rateCard?.id],
  );

  const all = stm.data ?? [];
  const mine = all.filter((s) => s.month === selected);
  const consumers = [...new Set(all.map((s) => s.personId))];
  const single = ws.role === "consumer";
  const projected = mine.length > 0 && mine.every((s) => s.basis === "Projected");
  // Until there is a menu, prices and someone to bill, there is nothing to say about who owes what.
  const billable =
    Boolean(boot.menu && boot.rateCard) && boot.people.some((p) => p.role === "consumer");

  const series = consumers.map((id) => ({
    name: single ? "Bill" : ws.nameOf(id),
    values: range.map((m) => all.find((s) => s.personId === id && s.month === m)?.billed ?? null),
  }));
  const rateLine = boot.rateCard
    ? `${[
        ...priceWords(boot, boot.rateCard.prices, money),
        ...(boot.rateCard.monthlyFee > 0 ? [`Monthly fee ${money(boot.rateCard.monthlyFee)}`] : []),
      ].join(" · ")} · from ${date(boot.rateCard.effectiveFrom)}`
    : null;

  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Dashboard"
        lead={billingLead(single, boot.me.name, billable)}
        actions={
          <>
            <Chip tone={projected ? undefined : "good"}>{projected ? "Projected" : "Actual"}</Chip>
            <MonthPicker
              months={boot.months.length ? boot.months : [boot.currentMonth]}
              value={selected}
              onChange={setSelected}
              current={boot.currentMonth}
            />
          </>
        }
      />
      {boot.organisation ? (
        <p className="muted small">
          This kitchen shares its totals (how many people, how many meals, and what is billed, paid
          and owed, with no names) with {boot.organisation.name}.
        </p>
      ) : null}
      <Problem error={bodyProblem(stm.error, boot.setup)} />
      {stm.loading && !stm.data ? <Spinner /> : null}

      {mine.length > 0 ? (
        <div className="tilegroups">
          <div className="tiles lead">
            <Tile
              lead
              label="Bill"
              value={money(sum(mine, (s) => s.billed))}
              projected={projected}
            />
            <Tile lead label="Paid" value={money(sum(mine, (s) => s.paid))} />
            <Tile
              lead
              label="Balance"
              value={money(sum(mine, (s) => s.balance))}
              projected={projected}
            />
          </div>
          <div className="tiles">
            <Tile label="Actual to date" value={money(sum(mine, (s) => s.actualToDate))} />
            <Tile label="Claimed" value={money(sum(mine, (s) => s.claimedPending))} />
            <Tile label="Earlier unpaid" value={money(sum(mine, (s) => s.earlierUnpaid))} />
            {single && mine[0] ? (
              <Tile
                label="Status"
                value={<span className="tile-text">{STATUS_LABEL[mine[0].status]}</span>}
              />
            ) : null}
            {!single ? <Tile label="To confirm" value={boot.pendingClaims || "-"} /> : null}
          </div>
        </div>
      ) : !stm.loading && boot.rateCard ? (
        <p className="muted">Nothing to show for {monthLabel(selected)} yet.</p>
      ) : null}

      {!single && mine.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="r">Meals</th>
                <th className="r">Leave</th>
                <th className="r">Bill</th>
                <th className="r">Actual</th>
                <th className="r">Paid</th>
                <th className="r">Balance</th>
                <th>Status</th>
                <th className="r">Earlier unpaid</th>
                <th className="r">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.personId} className={s.basis === "Projected" ? "projected" : ""}>
                  <td>{s.name}</td>
                  <td className="r">{s.counts.meals}</td>
                  <td className="r">{s.counts.leave || "-"}</td>
                  <td className="r">{money(s.billed)}</td>
                  <td className="r">{money(s.actualToDate)}</td>
                  <td className="r">{money(s.paid)}</td>
                  <td className="r">{money(s.balance)}</td>
                  <td>
                    <Chip tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Chip>
                  </td>
                  <td className="r">{money(s.earlierUnpaid)}</td>
                  <td className="r">{money(s.claimedPending)}</td>
                </tr>
              ))}
            </tbody>
            {mine.length > 1 ? (
              <tfoot>
                <tr>
                  <th>Receivable</th>
                  <th />
                  <th />
                  <th className="r">{money(sum(mine, (s) => s.billed))}</th>
                  <th className="r">{money(sum(mine, (s) => s.actualToDate))}</th>
                  <th className="r">{money(sum(mine, (s) => s.paid))}</th>
                  <th className="r">{money(sum(mine, (s) => s.balance))}</th>
                  <th />
                  <th className="r">{money(sum(mine, (s) => s.earlierUnpaid))}</th>
                  <th className="r">{money(sum(mine, (s) => s.claimedPending))}</th>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {single && mine[0] && mine[0].changedAfterClose !== 0 ? (
        <div className="banner warn">
          This month was closed, and entries changed afterwards by{" "}
          {money(Math.abs(mine[0].changedAfterClose))}.
        </div>
      ) : null}

      {mine.length > 0 ? (
        <section className="stack" aria-label="Bill lines">
          <h2>{single ? "Your bill" : "Bills, line by line"}</h2>
          {mine.map((s) => (
            <BillLines key={s.personId} statement={s} name={single ? null : s.name} />
          ))}
        </section>
      ) : null}

      {series.length > 0 ? (
        <section className="card stack" aria-label="Monthly bill">
          <h2>Monthly bill</h2>
          <BarChart
            categories={range}
            projected={range.map((m) =>
              all.filter((s) => s.month === m).every((s) => s.basis === "Projected"),
            )}
            series={series}
            label={
              single
                ? "Your bill for each of the last months"
                : "Each person’s bill for each of the last months"
            }
          />
        </section>
      ) : null}
      {rateLine ? <p className="muted small">{rateLine}</p> : null}
    </div>
  );
}
