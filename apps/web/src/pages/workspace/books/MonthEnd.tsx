import { isMoneyStatement, type MealStatementDto, type StatementDto } from "@alimentation/core";
import { useState } from "react";
import { api, getJson, postJson } from "../../../api.ts";
import { Button } from "../../../components/legacy/button.tsx";
import {
  Chip,
  Dialog,
  MonthPicker,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../../components/ui.tsx";
import { money, month as monthLabel } from "../../../format.ts";
import { useWorkspace } from "../context.tsx";

export function CloseMonths() {
  const ws = useWorkspace();
  const { boot } = ws;
  // The latest month a close makes sense for is the one that has ended.
  const closable = boot.months.filter((m) => m < boot.currentMonth);
  const [selected, setSelected] = useState(closable.at(-1) ?? boot.currentMonth);
  // What is ready to close: with prices for a kitchen that tracks money, with a menu for one that does not.
  const ready = ws.money ? !!boot.rateCard : !!boot.menu;
  const res = useLoad(
    () =>
      ready
        ? getJson<(StatementDto | MealStatementDto)[]>(`${ws.api}/statements?months=${selected}`)
        : Promise.resolve([] as (StatementDto | MealStatementDto)[]),
    [ws.api, selected, ready],
  );
  const act = useAction();
  const [confirm, setConfirm] = useState<"all" | null>(null);
  const rows = res.data ?? [];
  const open = rows.filter((s) => !s.closed);
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Month close"
        lead={
          ws.money
            ? "Closing freezes what each person is billed. Entries changed later show up as “changed after close” with the difference, and never alter the bill."
            : "Closing locks the month for each person, so nobody can change their meals, leave or extras after it."
        }
        actions={
          <MonthPicker
            months={boot.months.length ? boot.months : [boot.currentMonth]}
            value={selected}
            onChange={setSelected}
            current={boot.currentMonth}
          />
        }
      />
      <Problem error={act.error ?? res.error} />
      {res.loading && !res.data ? <Spinner /> : null}
      {rows.length > 0 ? (
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
                {ws.money ? (
                  <>
                    <th className="r">Live total</th>
                    <th className="r">Billed</th>
                  </>
                ) : (
                  <th className="r">Meals</th>
                )}
                <th>State</th>
                {ws.money ? <th>Still waiting</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.personId}>
                  <td>{s.name}</td>
                  {isMoneyStatement(s) ? (
                    <>
                      <td className="r">{money(s.liveTotal)}</td>
                      <td className="r">{s.closed ? money(s.billed) : "-"}</td>
                    </>
                  ) : (
                    <td className="r">{s.counts.meals}</td>
                  )}
                  <td>
                    {s.closed ? (
                      <Chip tone="good">{ws.money ? "Closed" : "Locked"}</Chip>
                    ) : (
                      <Chip>Open</Chip>
                    )}
                    {isMoneyStatement(s) && s.changedAfterClose !== 0 ? (
                      <Chip tone="bad">Changed after close {money(s.changedAfterClose)}</Chip>
                    ) : null}
                  </td>
                  {isMoneyStatement(s) ? (
                    <td>
                      {s.claimedPending > 0 ? (
                        <Chip tone="warn">{money(s.claimedPending)} claimed, not decided</Chip>
                      ) : null}
                      {s.openQueries > 0 ? (
                        <Chip tone="bad">
                          {s.openQueries} {s.openQueries === 1 ? "query" : "queries"} open
                        </Chip>
                      ) : null}
                      {s.claimedPending === 0 && s.openQueries === 0 ? "-" : null}
                    </td>
                  ) : null}
                  <td>
                    {s.closed ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={act.busy || !ws.writable}
                        onClick={() =>
                          void act.run(async () => {
                            await api.del(`${ws.api}/closes/${selected}/${s.personId}`);
                            toast("Reopened.");
                            res.reload();
                          })
                        }
                      >
                        Reopen
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        type="button"
                        disabled={act.busy || !ws.writable}
                        onClick={() =>
                          void act.run(async () => {
                            await postJson(`${ws.api}/closes`, {
                              month: selected,
                              consumerId: s.personId,
                            });
                            toast("Closed.");
                            res.reload();
                          })
                        }
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <p className="muted small">
          {ws.money
            ? "Closing freezes meals, leave and extras. Payments are not frozen: a claim can still be made, confirmed or settled after the month is closed, so nobody has to rush the supplier."
            : "Closing locks meals, leave and extras. You can reopen a month for a person if something has to change."}
        </p>
      ) : null}
      {open.length > 1 ? (
        <div>
          <Button
            type="button"
            disabled={act.busy || !ws.writable}
            onClick={() => setConfirm("all")}
          >
            Close {monthLabel(selected)} for everyone
          </Button>
        </div>
      ) : null}
      <Dialog
        open={confirm === "all"}
        onClose={() => setConfirm(null)}
        title={`Close ${monthLabel(selected)} for everyone?`}
      >
        <p>
          {ws.money ? `This freezes ${open.length} bills.` : `This locks ${open.length} months.`}{" "}
          You can reopen any of them afterwards, and the reopening is recorded.
          {open.some((s) => isMoneyStatement(s) && (s.claimedPending > 0 || s.openQueries > 0))
            ? " Some of them still have a claim waiting for the supplier, or a query open. Those carry on after the close."
            : ""}
        </p>
        <div className="row">
          <Button
            type="button"
            onClick={() =>
              void act.run(async () => {
                await postJson(`${ws.api}/closes`, { month: selected });
                setConfirm(null);
                toast("Closed.");
                res.reload();
              })
            }
          >
            Close them
          </Button>
          <Button variant="outline" type="button" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
