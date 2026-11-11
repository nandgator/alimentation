import {
  dayName,
  type IsoDate,
  type LedgerDay,
  type LedgerDto,
  type MealLedgerDay,
  weekdayOf,
} from "@alimentation/core";
import { useState } from "react";
import { getJson } from "../../api.ts";
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
  // Days with a price on them for a kitchen that tracks money; the same days without one for a kitchen that does not.
  const days: (MealLedgerDay | LedgerDay)[] = res.data?.days ?? [];
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
              {days
                .filter((d) => d.status !== "Inactive")
                .map((d) => {
                  const extras = [
                    d.extraChapati ? `${d.extraChapati} chapati` : "",
                    d.extraBhakri ? `${d.extraBhakri} bhakri` : "",
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <tr key={d.date} className={d.basis === "Projected" ? "projected" : ""}>
                      <td>
                        {date(d.date)}{" "}
                        <span className="muted">{dayName(weekdayOf(d.date as IsoDate))}</span>
                      </td>
                      <td>
                        <Chip
                          tone={
                            d.status === "Meal" ? undefined : d.status === "Leave" ? "warn" : "good"
                          }
                        >
                          {d.status}
                          {d.holidayName ? ` · ${d.holidayName}` : ""}
                        </Chip>
                      </td>
                      <td>{d.meal ?? "-"}</td>
                      <td className="r">{extras || "-"}</td>
                      {ws.money ? (
                        <td className="r">{"dayTotal" in d ? money(d.dayTotal) : "-"}</td>
                      ) : null}
                    </tr>
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
