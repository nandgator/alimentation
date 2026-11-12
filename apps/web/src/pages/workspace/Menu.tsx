import {
  DEFAULT_POLICY,
  dayName,
  type MenuVersion,
  must,
  type PolicyView,
  type Weekday,
} from "@alimentation/core";
import { useState } from "react";
import { getJson, postJson } from "../../api.ts";
import { inOrder, itemName, liveOn, offerable, serviceName } from "../../catalogue.ts";
import {
  Dialog,
  Field,
  Form,
  PageHead,
  Problem,
  SectionHead,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../components/ui.tsx";
import { date } from "../../format.ts";
import {
  type Grid,
  gridFrom,
  menuBody,
  setCell,
  toggleOffered,
  unservedDays,
} from "../../menuGrid.ts";
import { useWorkspace } from "./context.tsx";

const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const NOT_SERVED = "";

/**
 * What is served, from a date: a grid of the days the kitchen cooks against its services, every cell a meal or
 * "Not served", and for each service the items it offers. A kitchen with one service sees one column and no
 * service name anywhere.
 */
function MenuForm({
  last,
  working,
  onDone,
}: {
  last: MenuVersion | null;
  working: readonly Weekday[];
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const { boot } = ws;
  const services = inOrder(liveOn(boot.services, boot.today));
  const several = services.length >= 2;
  const meals = offerable(boot, "meal", boot.today);
  const addOns = offerable(boot, "addon", boot.today);
  // The first menu starts with the month, as people and prices do; a later one starts today.
  const [from, setFrom] = useState(boot.menu ? boot.today : `${boot.today.slice(0, 7)}-01`);
  const [grid, setGrid] = useState<Grid>(() => gridFrom(last, services, [...meals, ...addOns]));
  const [note, setNote] = useState("");
  const act = useAction();
  const ids = services.map((s) => s.id);
  const days = WEEK.filter((d) => working.includes(d));
  const unserved = unservedDays(grid, ids, days);
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await postJson(`${ws.api}/menus`, menuBody(grid, ids, days, from, note));
          toast("Menu added.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        A menu is never changed after the fact: a new one applies from its date onwards. Every day
        the kitchen cooks needs a meal{several ? " in at least one service" : ""}.
      </p>
      <Field label="Applies from" id="mfrom">
        <input
          id="mfrom"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <div
        className="tablewrap"
        tabIndex={0}
        role="region"
        aria-label="Menu by day; scrolls sideways when it is wider than the screen"
      >
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {services.map((sv) => (
                <th key={sv.id}>{several ? sv.name : "Meal"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <th scope="row">{dayName(d)}</th>
                {services.map((sv) => (
                  <td key={sv.id}>
                    <select
                      aria-label={several ? `${dayName(d)}, ${sv.name}` : `Menu on ${dayName(d)}`}
                      value={grid.cells[sv.id]?.[d] ?? NOT_SERVED}
                      onChange={(e) => setGrid(setCell(grid, sv.id, d, e.target.value))}
                    >
                      <option value={NOT_SERVED}>Not served</option>
                      {meals.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unserved.length > 0 ? (
        <div className="banner warn" role="status">
          Nothing is served on {unserved.map((d) => dayName(d)).join(", ")}. Choose a meal, or take
          the day off in the rules.
        </div>
      ) : null}
      {services.map((sv) => {
        const served = new Set(Object.values(grid.cells[sv.id] ?? {}));
        const on = new Set(grid.offered[sv.id] ?? []);
        return (
          <fieldset key={sv.id} className="choices">
            <legend>{several ? `Offered in ${sv.name}` : "Also offered"}</legend>
            <p className="muted small">
              The other meals one may switch to, and the add-ons one may ask for. A meal on the grid
              is always offered.
            </p>
            <div className="row chip-checks">
              {[...meals, ...addOns].map((it) => {
                const forced = served.has(it.id);
                return (
                  <label key={it.id} className="chip-check">
                    <input
                      type="checkbox"
                      checked={forced || on.has(it.id)}
                      disabled={forced}
                      onChange={(e) => setGrid(toggleOffered(grid, sv.id, it.id, e.target.checked))}
                    />
                    <span>{it.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <Field label="Note (optional)" id="mnote">
        <input id="mnote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <button type="submit" className="btn" disabled={act.busy || unserved.length > 0}>
          Add menu
        </button>
      </div>
    </Form>
  );
}

function MenuTable({ menu, working }: { menu: MenuVersion; working: readonly Weekday[] }) {
  const { boot } = useWorkspace();
  const services = inOrder(boot.services).filter((s) => menu.days[s.id] || menu.offered[s.id]);
  const several = boot.services.length >= 2;
  return (
    <div className="stack">
      <div
        className="tablewrap"
        tabIndex={0}
        role="region"
        aria-label={`Menu from ${date(menu.effectiveFrom)}; scrolls sideways when it is wider than the screen`}
      >
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {services.map((sv) => (
                <th key={sv.id}>{several ? sv.name : "Meal"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEK.filter((d) => working.includes(d)).map((d) => (
              <tr key={d}>
                <th scope="row">{dayName(d)}</th>
                {services.map((sv) => {
                  const meal = menu.days[sv.id]?.[d];
                  return <td key={sv.id}>{meal ? itemName(boot, meal) : "Not served"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {services.map((sv) => {
        const rest = (menu.offered[sv.id] ?? []).filter(
          (id) => !Object.values(menu.days[sv.id] ?? {}).includes(id),
        );
        return rest.length > 0 ? (
          <p key={sv.id} className="muted small">
            {several ? `${serviceName(boot, sv.id)} also offers: ` : "Also offered: "}
            {rest.map((id) => itemName(boot, id)).join(", ")}.
          </p>
        ) : null;
      })}
      {menu.note ? <p className="muted small">{menu.note}</p> : null}
    </div>
  );
}

/** The menus of a kitchen, newest first. Every kitchen has them, whether or not it tracks money. */
export function Menu() {
  const ws = useWorkspace();
  const menus = useLoad(() => getJson<MenuVersion[]>(`${ws.api}/menus`), [ws.api]);
  const pols = useLoad(
    () => getJson<{ effectiveFrom: string; doc: PolicyView }[]>(`${ws.api}/policies`),
    [ws.api],
  );
  const [open, setOpen] = useState(false);
  const list = [...(menus.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const current = pols.data?.length
    ? must(pols.data[pols.data.length - 1]).doc
    : (ws.boot.policy ?? DEFAULT_POLICY);
  const working = current.workingDays as Weekday[];
  const hasMeals =
    offerable(ws.boot, "meal", ws.boot.today).length > 0 &&
    liveOn(ws.boot.services, ws.boot.today).length > 0;
  return (
    <div className="stack" style={{ ["--gap" as string]: "24px" }}>
      <PageHead title="Menu" lead="What is served on each day the kitchen cooks." />
      <Problem error={menus.error ?? pols.error} />
      <section className="stack" aria-label="Menus">
        <SectionHead
          title="Menus"
          actions={
            <button
              type="button"
              className="btn small"
              disabled={!ws.writable || !hasMeals}
              onClick={() => setOpen(true)}
            >
              New menu
            </button>
          }
        />
        {!hasMeals ? (
          <p className="muted">
            Add a service and a meal to the catalogue first, then put the meal on the menu.
          </p>
        ) : null}
        {menus.loading && !menus.data ? <Spinner /> : null}
        {list.map((m, i) =>
          i === 0 ? (
            <div key={m.id} className="stack">
              <h3>From {date(m.effectiveFrom)}</h3>
              <MenuTable menu={m} working={working} />
            </div>
          ) : (
            <details key={m.id}>
              <summary>From {date(m.effectiveFrom)}</summary>
              <MenuTable menu={m} working={working} />
            </details>
          ),
        )}
        {list.length === 0 && !menus.loading ? (
          <p className="muted">No menu yet. Meals are counted from the day a menu starts.</p>
        ) : null}
      </section>
      <Dialog open={open} onClose={() => setOpen(false)} title="New menu">
        {open ? (
          <MenuForm
            last={list[0] ?? null}
            working={working}
            onDone={() => {
              setOpen(false);
              menus.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
