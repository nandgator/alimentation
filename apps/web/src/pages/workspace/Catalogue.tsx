import type { CatalogueItemDto, ItemKind, Service } from "@alimentation/core";
import { useState } from "react";
import { api, getJson, postJson } from "../../api.ts";
import { inOrder, retiredBy } from "../../catalogue.ts";
import {
  Chip,
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
import { date, money } from "../../format.ts";
import { useWorkspace } from "./context.tsx";

type Target = { what: "service"; row: Service } | { what: "item"; row: CatalogueItemDto } | null;

/** A new service, such as lunch or dinner. */
function AddService({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const act = useAction();
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await postJson(`${ws.api}/services`, { name: name.trim() });
          toast("Service added.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        Everyone already in the kitchen takes it from the first of this month. You can change who
        takes what under People.
      </p>
      <Field label="Name" id="svc-name" hint="For example Breakfast, Lunch or Dinner.">
        <input
          id="svc-name"
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div>
        <button type="submit" className="btn" disabled={act.busy}>
          Add service
        </button>
      </div>
    </Form>
  );
}

/** A new meal or add-on. Its kind, unit and largest quantity are fixed once it is made. */
function AddItem({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const [kind, setKind] = useState<ItemKind>("meal");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("plate");
  const [maxQty, setMaxQty] = useState("20");
  const act = useAction();
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await postJson(`${ws.api}/catalogue`, {
            kind,
            name: name.trim(),
            unit: unit.trim(),
            maxQty: kind === "addon" ? Number(maxQty) || 20 : 20,
          });
          toast("Added.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        Its kind, unit and largest quantity cannot be changed later. Its name can. New food means a
        new item.
      </p>
      <fieldset className="choices">
        <legend>Kind</legend>
        <div className="row">
          <label className="row">
            <input
              type="radio"
              name="item-kind"
              checked={kind === "meal"}
              onChange={() => {
                setKind("meal");
                setUnit("plate");
              }}
            />
            Meal (served each day)
          </label>
          <label className="row">
            <input
              type="radio"
              name="item-kind"
              checked={kind === "addon"}
              onChange={() => {
                setKind("addon");
                setUnit("piece");
              }}
            />
            Add-on (asked for as an extra)
          </label>
        </div>
      </fieldset>
      <div className="pair">
        <Field label="Name" id="item-name">
          <input
            id="item-name"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Counted in" id="item-unit" hint="For example plate, piece or cup.">
          <input
            id="item-unit"
            required
            maxLength={20}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>
        {kind === "addon" ? (
          <Field label="Most in one entry" id="item-max">
            <input
              id="item-max"
              type="number"
              min={1}
              max={99}
              value={maxQty}
              onChange={(e) => setMaxQty(e.target.value)}
            />
          </Field>
        ) : null}
      </div>
      <div>
        <button type="submit" className="btn" disabled={act.busy}>
          Add
        </button>
      </div>
    </Form>
  );
}

function Rename({ target, onDone }: { target: NonNullable<Target>; onDone: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState(target.row.name);
  const act = useAction();
  const path = target.what === "service" ? "services" : "catalogue";
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await api.patch(`${ws.api}/${path}/${target.row.id}`, { name: name.trim() });
          toast("Renamed.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        The new name shows everywhere, in past months too. Bills do not change: they follow the
        item, not its name.
      </p>
      <Field label="Name" id="rename">
        <input
          id="rename"
          required
          maxLength={target.what === "service" ? 40 : 60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div>
        <button type="submit" className="btn" disabled={act.busy}>
          Rename
        </button>
      </div>
    </Form>
  );
}

function Retire({ target, onDone }: { target: NonNullable<Target>; onDone: () => void }) {
  const ws = useWorkspace();
  const act = useAction();
  const path = target.what === "service" ? "services" : "catalogue";
  return (
    <div className="stack">
      <p>
        Retire <strong>{target.row.name}</strong>? It stops being offered from today. Past months,
        bills and history keep it. This cannot be undone, and a retired name stays taken.
      </p>
      <Problem error={act.error} />
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              await api.patch(`${ws.api}/${path}/${target.row.id}`, { archived: true });
              toast("Retired.");
              onDone();
              ws.reload();
            })
          }
        >
          Retire {target.row.name}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Keep it
        </button>
      </div>
    </div>
  );
}

function Status({ row, today }: { row: { archivedOn: string | null }; today: string }) {
  return row.archivedOn === null ? (
    <Chip tone="good">In use</Chip>
  ) : retiredBy(row, today) ? (
    <Chip>Retired {date(row.archivedOn)}</Chip>
  ) : (
    <Chip tone="warn">Retires {date(row.archivedOn)}</Chip>
  );
}

/**
 * What the kitchen serves: its services and its items. Items are meals and add-ons; both can be renamed and
 * retired, and neither is ever deleted, so a past bill can always name what it was for.
 */
export function Catalogue() {
  const ws = useWorkspace();
  const { boot } = ws;
  const items = useLoad(() => getJson<CatalogueItemDto[]>(`${ws.api}/catalogue`), [ws.api]);
  const [adding, setAdding] = useState<"service" | "item" | null>(null);
  const [rename, setRename] = useState<Target>(null);
  const [retire, setRetire] = useState<Target>(null);
  const all = items.data ?? boot.catalogue;
  const services = inOrder(boot.services);
  const liveServices = services.filter((s) => !retiredBy(s, boot.today));
  const priced = (i: CatalogueItemDto) => {
    const base = i.prices?.find((p) => p.serviceId === null);
    return base ? money(base.amount) : i.prices ? "Not priced" : null;
  };
  const section = (kind: ItemKind, title: string) => {
    const rows = all.filter((i) => i.kind === kind);
    return (
      <section className="stack" aria-label={title}>
        <SectionHead title={title} />
        {rows.length === 0 ? (
          <p className="muted">
            {kind === "meal" ? "No meals yet. Add what you serve." : "No add-ons yet."}
          </p>
        ) : (
          <div
            className="tablewrap"
            tabIndex={0}
            role="region"
            aria-label={`${title}; scrolls sideways when it is wider than the screen`}
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Counted in</th>
                  {kind === "addon" ? <th className="r">Most in one entry</th> : null}
                  {ws.money ? <th className="r">Price</th> : null}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={retiredBy(i, boot.today) ? "projected" : ""}>
                    <td>{i.name}</td>
                    <td>{i.unit}</td>
                    {kind === "addon" ? <td className="r">{i.maxQty}</td> : null}
                    {ws.money ? <td className="r">{priced(i) ?? "-"}</td> : null}
                    <td>
                      <Status row={i} today={boot.today} />
                    </td>
                    <td className="r">
                      <button
                        type="button"
                        className="quiet"
                        disabled={!ws.writable}
                        aria-label={`Rename ${i.name}`}
                        onClick={() => setRename({ what: "item", row: i })}
                      >
                        Rename
                      </button>
                      {i.archivedOn === null ? (
                        <button
                          type="button"
                          className="quiet"
                          disabled={!ws.writable}
                          aria-label={`Retire ${i.name}`}
                          onClick={() => setRetire({ what: "item", row: i })}
                        >
                          Retire
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };
  return (
    <div className="stack" style={{ ["--gap" as string]: "24px" }}>
      <PageHead
        title="Catalogue"
        lead="What the kitchen serves and when. The menu puts these on days; prices come after."
        actions={
          <button
            type="button"
            className="btn small"
            disabled={!ws.writable}
            onClick={() => setAdding("item")}
          >
            Add an item
          </button>
        }
      />
      <Problem error={items.error} />
      <section className="stack" aria-label="Services">
        <SectionHead
          title={liveServices.length > 1 ? "Services" : "Service"}
          actions={
            <button
              type="button"
              className="btn small"
              disabled={!ws.writable}
              onClick={() => setAdding("service")}
            >
              Add a service
            </button>
          }
        />
        {services.length === 0 ? (
          <p className="muted">
            No service yet. A service is a time of day you serve, such as Lunch. Add one, then the
            meals.
          </p>
        ) : (
          <div
            className="tablewrap"
            tabIndex={0}
            role="region"
            aria-label="Services; scrolls sideways when it is wider than the screen"
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={retiredBy(s, boot.today) ? "projected" : ""}>
                    <td>{s.name}</td>
                    <td>
                      <Status row={s} today={boot.today} />
                    </td>
                    <td className="r">
                      <button
                        type="button"
                        className="quiet"
                        disabled={!ws.writable}
                        aria-label={`Rename ${s.name}`}
                        onClick={() => setRename({ what: "service", row: s })}
                      >
                        Rename
                      </button>
                      {s.archivedOn === null && liveServices.length > 1 ? (
                        <button
                          type="button"
                          className="quiet"
                          disabled={!ws.writable}
                          aria-label={`Retire ${s.name}`}
                          onClick={() => setRetire({ what: "service", row: s })}
                        >
                          Retire
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {items.loading && !items.data ? <Spinner /> : null}
      {section("meal", "Meals")}
      {section("addon", "Add-ons")}
      <Dialog open={adding === "service"} onClose={() => setAdding(null)} title="Add a service">
        {adding === "service" ? <AddService onDone={() => setAdding(null)} /> : null}
      </Dialog>
      <Dialog open={adding === "item"} onClose={() => setAdding(null)} title="Add an item">
        {adding === "item" ? (
          <AddItem
            onDone={() => {
              setAdding(null);
              items.reload();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={!!rename} onClose={() => setRename(null)} title="Rename">
        {rename ? (
          <Rename
            target={rename}
            onDone={() => {
              setRename(null);
              items.reload();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={!!retire} onClose={() => setRetire(null)} title="Retire">
        {retire ? (
          <Retire
            target={retire}
            onDone={() => {
              setRetire(null);
              items.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
