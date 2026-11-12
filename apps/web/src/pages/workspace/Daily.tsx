import {
  dayName,
  type IsoDate,
  type LedgerDto,
  type LedgerRow,
  type MealLedgerRow,
  weekdayOf,
} from "@alimentation/core";
import { Fragment, useState } from "react";
import { getJson } from "../../api.ts";
import { everSeveral, groupByDate, itemName, serviceName } from "../../catalogue.ts";
import { Chip, MonthPicker, PageHead, Problem, Spinner, useLoad } from "../../components/ui.tsx";
import { date, money } from "../../format.ts";
import { useWorkspace } from "./context.tsx";

export function Daily() {
  const ws = useWorkspace();
  const { boot } = ws;
  const consumers = boot.people.filter((p) => p.role === "consumer");
  const [person, setPerson] = useState(
    ws.role === "consumer" ? boot.me.personId : (consumers[0]?.id ?? ""),
  );
  const [selected, setSelected] = useState(boot.currentMonth);
  const res = useLoad(
    () =>
      person
        ? getJson<LedgerDto>(`${ws.api}/ledger?month=${selected}&person=${person}`)
        : Promise.resolve(null),
    [ws.api, selected, person],
  );
  // Rows with a price on them for a kitchen that tracks money; the same rows without one for a kitchen that does not.
  const rows: (MealLedgerRow | LedgerRow)[] = res.data?.rows ?? [];
  const days = groupByDate(rows);
  const several = everSeveral(boot);
  const tone = (status: string) =>
    status === "Meal" ? undefined : status === "Leave" ? ("warn" as const) : ("good" as const);
  const extrasOf = (r: MealLedgerRow | LedgerRow) =>
    r.addOns.map((a) => `${a.qty} ${itemName(boot, a.itemId)}`).join(", ");
  const amountOf = (r: MealLedgerRow | LedgerRow) => ("rowTotal" in r ? r.rowTotal : null);
  return (
    <div className="stack">
      <PageHead
        title="Daily"
        lead={
          ws.role === "consumer" ? "Your month, day by day." : "One person’s month, day by day."
        }
        actions={
          <>
            {ws.role !== "consumer" ? (
              <select
                aria-label="Person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="fit"
              >
                {consumers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            <MonthPicker
              months={boot.months.length ? boot.months : [boot.currentMonth]}
              value={selected}
              onChange={setSelected}
              current={boot.currentMonth}
            />
          </>
        }
      />
      <Problem error={res.error} />
      {res.loading && !res.data ? <Spinner /> : null}
      {days.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Meal</th>
                <th className="r">Extras</th>
                {ws.money ? <th className="r">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {days.map(({ date: d, rows: here }) => {
                const first = here[0];
                if (!first) return null;
                const projected = here.every((r) => r.basis === "Projected");
                const dayCell = (
                  <td>
                    {date(d)} <span className="muted">{dayName(weekdayOf(d as IsoDate))}</span>
                  </td>
                );
                const holiday = here.find((r) => r.holidayName)?.holidayName;
                if (!several) {
                  const amount = amountOf(first);
                  return (
                    <tr key={d} className={projected ? "projected" : ""}>
                      {dayCell}
                      <td>
                        <Chip tone={tone(first.status)}>
                          {first.status}
                          {holiday ? ` · ${holiday}` : ""}
                        </Chip>
                      </td>
                      <td>{first.mealId ? itemName(boot, first.mealId) : "-"}</td>
                      <td className="r">{extrasOf(first) || "-"}</td>
                      {ws.money ? (
                        <td className="r">{amount === null ? "-" : money(amount)}</td>
                      ) : null}
                    </tr>
                  );
                }
                // Two or more services: the day, then a row for each service it was served in.
                const alike = here.every((r) => r.status === first.status);
                const total = here.reduce((n, r) => n + (amountOf(r) ?? 0), 0);
                return (
                  <Fragment key={d}>
                    <tr className={`day-row${projected ? " projected" : ""}`}>
                      {dayCell}
                      <td>
                        {alike ? (
                          <Chip tone={tone(first.status)}>
                            {first.status}
                            {holiday ? ` · ${holiday}` : ""}
                          </Chip>
                        ) : (
                          <Chip>Mixed</Chip>
                        )}
                      </td>
                      <td />
                      <td />
                      {ws.money ? <td className="r">{money(total)}</td> : null}
                    </tr>
                    {here.map((r) => {
                      const amount = amountOf(r);
                      return (
                        <tr
                          key={`${d}-${r.serviceId}`}
                          className={`service-row${r.basis === "Projected" ? " projected" : ""}`}
                        >
                          <td className="muted">{serviceName(boot, r.serviceId)}</td>
                          <td>
                            <Chip tone={tone(r.status)}>{r.status}</Chip>
                          </td>
                          <td>{r.mealId ? itemName(boot, r.mealId) : "-"}</td>
                          <td className="r">{extrasOf(r) || "-"}</td>
                          {ws.money ? (
                            <td className="r">{amount === null ? "-" : money(amount)}</td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !res.loading ? (
        <p className="muted">No days to show.</p>
      ) : null}
      <p className="muted small">
        {ws.money
          ? "Greyed days have not happened yet, so their amounts are projected."
          : "Greyed days have not happened yet, so they are what is expected."}
      </p>
    </div>
  );
}
