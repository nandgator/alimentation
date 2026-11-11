import {
  type HolidayImportMode,
  type HolidayImportResult,
  isMoneyStatement,
  type MealStatementDto,
  SETTLEMENT_TYPES,
  type SettlementDto,
  type SettlementType,
  type StatementDto,
} from "@alimentation/core";
import { useState } from "react";
import { api, getJson, postJson } from "../../api.ts";
import {
  Chip,
  Dialog,
  Field,
  Form,
  MonthPicker,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../components/ui.tsx";
import { date, money, month as monthLabel, toPaise } from "../../format.ts";
import { useWorkspace } from "./context.tsx";

export function Holidays() {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [day, setDay] = useState(ws.boot.today);
  const [endDay, setEndDay] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [importing, setImporting] = useState(false);
  const act = useAction();
  const list = [...ws.boot.holidays].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead title="Holidays" />
      <section className="card stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const range = endDay !== "" && endDay !== day;
              const made = await postJson<{ ids: string[] }>(
                `${ws.api}/holidays`,
                range ? { name, from: day, to: endDay, confirmed } : { name, date: day, confirmed },
              );
              setName("");
              setEndDay("");
              toast(made.ids.length > 1 ? `${made.ids.length} holidays added.` : "Holiday added.");
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Name" id="hname">
              <input
                id="hname"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Date" id="hdate">
              <input
                id="hdate"
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="End date (optional)"
            id="hend"
            hint="For several days in a row: one holiday is added for each day from the date to this one, weekends too."
          >
            <input
              id="hend"
              type="date"
              min={day}
              value={endDay}
              onChange={(e) => setEndDay(e.target.value)}
            />
          </Field>
          <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmed (a meal is not served and not billed)
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={act.busy || !ws.writable}>
              Add
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!ws.writable}
              onClick={() => setImporting(true)}
            >
              Import
            </button>
          </div>
        </Form>
      </section>
      <ImportHolidaysDialog open={importing} onClose={() => setImporting(false)} />
      {list.length === 0 ? <p className="muted">No holidays yet.</p> : null}
      {list.length > 0 ? (
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
                <th>Name</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id}>
                  <td>{date(h.date)}</td>
                  <td>{h.name}</td>
                  <td>
                    <Chip tone={h.confirmed ? "good" : "warn"}>
                      {h.confirmed ? "Confirmed" : "Tentative"}
                    </Chip>
                  </td>
                  <td>
                    <div className="row" style={{ ["--gap" as string]: "var(--space-2)" }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .patch(`${ws.api}/holidays/${h.id}`, { confirmed: !h.confirmed })
                            .then(ws.reload, (e: Error) => toast(e.message, "bad"))
                        }
                      >
                        {h.confirmed ? "Make tentative" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .del(`${ws.api}/holidays/${h.id}`)
                            .then(ws.reload, (e: Error) => toast(e.message, "bad"))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const IMPORT_EXAMPLE = "name,from,to,location,confirmed\nDiwali break,2026-11-08,2026-11-11,,yes";
const ACTION_WORDS = {
  create: ["Add", "good"],
  replace: ["Replace", "warn"],
  skip: ["Skip", undefined],
  error: ["Refused", "bad"],
} as const;

/** Holidays pasted or read from a file, previewed row by row before anything is written. */
function ImportHolidaysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<HolidayImportMode>("merge");
  const [partial, setPartial] = useState(false);
  const [preview, setPreview] = useState<HolidayImportResult | null>(null);
  const act = useAction();
  const body = (dryRun: boolean) => ({ mode, dryRun, partial, csv: text });
  const changed = () => setPreview(null);
  const refused = preview?.summary.error ?? 0;
  const close = () => {
    setText("");
    setPreview(null);
    setPartial(false);
    act.clear();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Import holidays">
      <div className="stack" style={{ ["--gap" as string]: "16px" }}>
        <Field
          label="Holidays"
          id="himport"
          hint={
            <>
              One holiday to a line, the first line naming the columns: name, from, to, location,
              confirmed. Only name and from (or date) are needed. For example:{" "}
              <code>{IMPORT_EXAMPLE.replace("\n", " / ")}</code>
            </>
          }
        >
          <textarea
            id="himport"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field label="Or choose a file" id="hfile">
          <input
            id="hfile"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((t) => {
                setText(t);
                changed();
              });
            }}
          />
        </Field>
        <fieldset className="stack choices" style={{ ["--gap" as string]: "8px" }}>
          <legend>If a day already has a holiday</legend>
          {(
            [
              [
                "merge",
                "Keep what is there and add the new ones (the same day, name and place is skipped).",
              ],
              [
                "overwrite",
                "Replace what is there on the days in the list. Other days are left alone.",
              ],
            ] as const
          ).map(([value, words]) => (
            <label key={value} className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  changed();
                }}
              />
              {words}
            </label>
          ))}
        </fieldset>
        {preview ? (
          <div className="stack" style={{ ["--gap" as string]: "8px" }}>
            <p>
              {preview.summary.create} to add, {preview.summary.replace} to replace
              {preview.summary.removed > 0 ? ` (taking away ${preview.summary.removed})` : ""},{" "}
              {preview.summary.skip} skipped, {preview.summary.error} refused.
            </p>
            <div
              className="tablewrap"
              tabIndex={0}
              role="region"
              aria-label="Preview; scrolls sideways when it is wider than the screen"
            >
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Date</th>
                    <th>Name</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.row}-${r.date ?? ""}-${r.action}-${r.name}-${r.message}`}>
                      <td>{r.row}</td>
                      <td>{r.date ? date(r.date) : ""}</td>
                      <td>{r.name}</td>
                      <td>
                        <Chip tone={ACTION_WORDS[r.action][1]}>{ACTION_WORDS[r.action][0]}</Chip>{" "}
                        {r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {refused > 0 ? (
              <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(e) => setPartial(e.target.checked)}
                />
                Add the rest and leave out the refused rows (otherwise nothing is added)
              </label>
            ) : null}
          </div>
        ) : null}
        <Problem error={act.error} />
        <div className="row">
          <button
            type="button"
            className="btn ghost"
            disabled={act.busy || text.trim() === ""}
            onClick={() =>
              void act.run(async () => {
                setPreview(
                  await postJson<HolidayImportResult>(`${ws.api}/holidays/bulk`, body(true)),
                );
              })
            }
          >
            Preview
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              act.busy ||
              !ws.writable ||
              !preview ||
              (refused > 0 && !partial) ||
              preview.summary.create + preview.summary.replace === 0
            }
            onClick={() =>
              void act.run(async () => {
                const done = await postJson<HolidayImportResult>(
                  `${ws.api}/holidays/bulk`,
                  body(false),
                );
                if (!done.committed) {
                  setPreview(done);
                  throw new Error("Nothing was added, because some rows were refused.");
                }
                toast(`${done.summary.create + done.summary.replace} holidays added.`);
                close();
                ws.reload();
              })
            }
          >
            Confirm
          </button>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function Settlements() {
  const ws = useWorkspace();
  const consumers = ws.boot.people.filter((p) => p.role === "consumer");
  const list = useLoad(() => getJson<SettlementDto[]>(`${ws.api}/settlements`), [ws.api]);
  const [who, setWho] = useState(consumers[0]?.id ?? "");
  const [forMonth, setForMonth] = useState(ws.boot.currentMonth);
  const [type, setType] = useState<SettlementType>("Payment");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const needsAmount = type !== "Query";
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Settlements"
        lead="An admin’s own entries: payments taken outside the app, queries raised, queries resolved. They are added, never changed."
      />
      <section className="card stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const paise = needsAmount ? toPaise(amount) : null;
              if (needsAmount && paise === null) throw new Error("Enter the amount in rupees.");
              await postJson(`${ws.api}/settlements`, {
                consumerId: who,
                forMonth,
                type,
                amount: paise,
                note: note.trim() || null,
              });
              setAmount("");
              setNote("");
              toast("Recorded.");
              list.reload();
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Who" id="swho">
              <select id="swho" value={who} onChange={(e) => setWho(e.target.value)}>
                {consumers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Month" id="smonth">
              <select
                id="smonth"
                value={forMonth}
                onChange={(e) => setForMonth(e.target.value as typeof forMonth)}
              >
                {[...ws.boot.months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type" id="stype">
              <select
                id="stype"
                value={type}
                onChange={(e) => setType(e.target.value as SettlementType)}
              >
                {SETTLEMENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {needsAmount ? (
              <Field label="Amount (₹)" id="samount">
                <input
                  id="samount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <Field label="Note" id="snote">
            <input
              id="snote"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div>
            <button type="submit" className="btn" disabled={act.busy || !ws.writable}>
              Record
            </button>
          </div>
        </Form>
      </section>
      <Problem error={list.error} />
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data && list.data.length > 0 ? (
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
                <th>Who</th>
                <th>Month</th>
                <th>Type</th>
                <th className="r">Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>{date(s.date)}</td>
                  <td>{ws.nameOf(s.consumerId)}</td>
                  <td>{monthLabel(s.forMonth)}</td>
                  <td>{s.type}</td>
                  <td className="r">{s.amount === null ? "-" : money(s.amount)}</td>
                  <td className="cell-text">{s.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

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
                      <button
                        type="button"
                        className="btn ghost small"
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
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn small"
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
                      </button>
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
          <button
            type="button"
            className="btn"
            disabled={act.busy || !ws.writable}
            onClick={() => setConfirm("all")}
          >
            Close {monthLabel(selected)} for everyone
          </button>
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
          <button
            type="button"
            className="btn"
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
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      </Dialog>
    </div>
  );
}
