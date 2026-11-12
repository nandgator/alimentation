import {
  addMonths,
  type Issue,
  type LogEntryDto,
  logChoices,
  type MenuVersion,
  monthEnd,
  monthStart,
} from "@alimentation/core";
import { useEffect, useState } from "react";
import { api, getJson, postJson } from "../../api.ts";
import {
  beforeMenuWords,
  describeEntry,
  itemName,
  menuIn,
  menuStartsAfter,
  serviceName,
} from "../../catalogue.ts";
import {
  Chip,
  Field,
  Form,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../components/ui.tsx";
import { date } from "../../format.ts";
import { allowedActions, type Pick, resolveForm, unionChoices } from "../../logForm.ts";
import { useWorkspace } from "./context.tsx";

const WHOLE_DAY = "";

export function LogPage() {
  const ws = useWorkspace();
  const { boot } = ws;
  const consumers = boot.people.filter((p) => p.role === "consumer");
  const mayManage = ws.role !== "consumer";
  const [who, setWho] = useState(mayManage ? (consumers[0]?.id ?? "") : boot.me.personId);
  const [day, setDay] = useState(boot.today);
  const [pick, setPick] = useState<Pick>({});
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const act = useAction();

  // The menu in force on the chosen day decides what can be logged for it.
  const menus = useLoad(() => getJson<MenuVersion[]>(`${ws.api}/menus`), [ws.api]);
  const known = menus.data ?? (boot.menu ? [boot.menu] : []);
  const menu = menuIn(known, day);
  // A day before the first menu has nothing to log: say why, beside the date, in place of a refusal.
  const menuStart = menuStartsAfter(known, day);
  const person = boot.people.find((p) => p.id === who);
  const choicesFor = (people: typeof consumers) =>
    people.map((p) => logChoices(menu, boot.catalogue, boot.services, p, day, boot.enrolments));
  // A day the kitchen is off is for everyone, so it is offered from what any member could be served.
  const dayOff = unionChoices(choicesFor(consumers)).filter((c) => c.action === "Supplier Off");
  const view = resolveForm(
    unionChoices([...choicesFor(person?.role === "consumer" ? [person] : []), dayOff]),
    allowedActions(ws.role),
    pick,
  );
  const wholeFor = view.action === "Supplier Off";
  const needsQty = view.action === "Extra";
  const body = {
    date: day,
    personId: wholeFor ? null : who || null,
    allConsumers: wholeFor,
    action: view.action,
    serviceId: view.serviceId,
    itemId: view.action === "Switch" || view.action === "Extra" ? view.itemId : null,
    qty: needsQty ? Number(qty) || 1 : null,
    note: note.trim() || null,
  };

  // Tell the person what is wrong before they press the button, not after.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `body` is built from the listed values
  useEffect(() => {
    if (!day || !view.action || (!wholeFor && !who)) return setIssues([]);
    const t = setTimeout(() => {
      postJson<{ issues: Issue[] }>(`${ws.api}/log/check`, body).then(
        (r) => setIssues(r.issues),
        () => setIssues([]),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [day, view.action, view.serviceId, view.itemId, qty, who, wholeFor, ws.api]);

  const from = monthStart(addMonths(boot.currentMonth, -1));
  const to = monthEnd(addMonths(boot.currentMonth, 1));
  const list = useLoad(
    () => getJson<LogEntryDto[]>(`${ws.api}/log?from=${from}&to=${to}`),
    [ws.api, from, to],
  );
  const shownIssues = menuStart ? [] : issues;
  const blocked = menuStart !== null || issues.some((i) => i.severity === "error");

  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead title={mayManage ? "Log" : "My log"} />
      <section className="card stack" aria-label="Add an entry">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              await postJson(`${ws.api}/log`, body);
              setNote("");
              toast("Saved.");
              list.reload();
              ws.reload();
            })
          }
        >
          <div className="pair">
            {mayManage && !wholeFor ? (
              <Field label="For" id="who">
                <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                  {consumers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Date" id="day" hint={menuStart ? beforeMenuWords(menuStart) : undefined}>
              <input
                id="day"
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            {view.action ? (
              <Field label="Change" id="change">
                <select
                  id="change"
                  value={view.action}
                  onChange={(e) =>
                    setPick({ action: e.target.value as Pick["action"], serviceId: undefined })
                  }
                >
                  {view.actions.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {view.showScope ? (
              <Field label="Applies to" id="scope">
                <select
                  id="scope"
                  value={view.serviceId ?? WHOLE_DAY}
                  onChange={(e) =>
                    setPick({
                      ...pick,
                      action: view.action ?? undefined,
                      serviceId: e.target.value || null,
                    })
                  }
                >
                  {view.scopes.map((sv) => (
                    <option key={sv ?? WHOLE_DAY} value={sv ?? WHOLE_DAY}>
                      {sv === null ? "Whole day" : serviceName(boot, sv)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {view.showService ? (
              <Field label="Service" id="service">
                <select
                  id="service"
                  value={view.serviceId ?? ""}
                  onChange={(e) =>
                    setPick({
                      action: view.action ?? undefined,
                      serviceId: e.target.value,
                      itemId: undefined,
                    })
                  }
                >
                  {view.services.map((sv) => (
                    <option key={sv} value={sv}>
                      {serviceName(boot, sv)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {view.action === "Switch" || view.action === "Extra" ? (
              <Field label={view.action === "Switch" ? "Switch to" : "Item"} id="item">
                <select
                  id="item"
                  value={view.itemId ?? ""}
                  onChange={(e) =>
                    setPick({
                      ...pick,
                      action: view.action ?? undefined,
                      serviceId: view.serviceId,
                      itemId: e.target.value,
                    })
                  }
                >
                  {view.items.map((id) => (
                    <option key={id} value={id}>
                      {itemName(boot, id)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {needsQty ? (
              <Field label="How many" id="qty">
                <input
                  id="qty"
                  type="number"
                  min={1}
                  max={view.maxQty ?? 99}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          {!view.action && !menuStart ? (
            <p className="muted small">
              Nothing can be logged for this person on this day: they are not eating, or the menu
              does not serve it.
            </p>
          ) : null}
          {wholeFor ? (
            <p className="muted small">A day the kitchen is off applies to everyone.</p>
          ) : null}
          <Field label="Note (optional)" id="note">
            <input
              id="note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {shownIssues.map((i, k) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: issues are shown in the order checked, and are replaced as a whole
              key={k}
              className={`banner ${i.severity === "error" ? "bad" : "warn"}`}
              role="status"
            >
              {i.message}
            </div>
          ))}
          <div>
            <button
              type="submit"
              className="btn"
              disabled={act.busy || blocked || !ws.writable || !view.action}
            >
              Add
            </button>
          </div>
        </Form>
      </section>

      <section className="stack">
        <h2>Recent entries</h2>
        <Problem error={list.error} />
        {list.loading && !list.data ? <Spinner /> : null}
        {list.data && list.data.length === 0 ? <p className="muted">Nothing logged yet.</p> : null}
        {list.data && list.data.length > 0 ? (
          <div
            className="tablewrap cards"
            tabIndex={0}
            role="region"
            aria-label="Table; scrolls sideways when it is wider than the screen"
          >
            <table className="cards">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Who</th>
                  <th>Change</th>
                  <th>Added by</th>
                  <th className="r">Qty</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.date)}</td>
                    <td data-label="Who">
                      {e.allConsumers ? "Everyone" : e.personId ? ws.nameOf(e.personId) : "-"}
                    </td>
                    <td data-label="Change">
                      <Chip tone={e.action === "Leave" ? "warn" : undefined}>
                        {describeEntry(boot, e)}
                      </Chip>
                    </td>
                    <td data-label="Added by">
                      {e.by}
                      {e.lateByDays > 0 ? (
                        <>
                          {" "}
                          <Chip tone="warn">
                            Late: {e.lateByDays} {e.lateByDays === 1 ? "day" : "days"} after
                          </Chip>
                        </>
                      ) : null}
                    </td>
                    <td className="r" data-label="Qty">
                      {e.qty ?? "-"}
                    </td>
                    <td className="cell-text" data-label="Note">
                      {e.note ?? ""}
                    </td>
                    <td>
                      {ws.writable ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() =>
                            void api.del(`${ws.api}/log/${e.id}`).then(
                              () => {
                                toast("Removed.");
                                list.reload();
                                ws.reload();
                              },
                              (err: Error) => toast(err.message, "bad"),
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
