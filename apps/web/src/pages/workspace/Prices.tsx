import type { MenuVersion, RateCard } from "@alimentation/core";
import { useState } from "react";
import { getJson, postJson } from "../../api.ts";
import { itemName, serviceName } from "../../catalogue.ts";
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
import { date, money } from "../../format.ts";
import {
  fieldsFrom,
  itemsToPrice,
  type PriceFields,
  priceBody,
  servicesOffering,
} from "../../priceForm.ts";
import { useWorkspace } from "./context.tsx";

/**
 * New prices from a date, one line for each item the menus offer. Where a kitchen has several services, an
 * item can cost something else in one of them; a kitchen with one never sees that.
 */
function CardForm({
  last,
  menus,
  onDone,
}: {
  last: RateCard | null;
  menus: readonly MenuVersion[];
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const { boot } = ws;
  const [from, setFrom] = useState(boot.today);
  const [fields, setFields] = useState<PriceFields>(() => fieldsFrom(last));
  const [note, setNote] = useState("");
  const act = useAction();
  const items = itemsToPrice(menus, boot.catalogue, from);
  const several =
    boot.services.filter((s) => s.archivedOn === null || s.archivedOn > from).length >= 2;
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          const body = priceBody(
            items,
            fields,
            (id) => itemName(boot, id),
            (id) => serviceName(boot, id),
          );
          if (!body.ok) throw new Error(body.message);
          await postJson(`${ws.api}/rate-cards`, {
            effectiveFrom: from,
            prices: body.prices,
            monthlyFee: body.monthlyFee,
            note: note.trim() || null,
          });
          toast("Prices added.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        Prices are never changed after the fact: new prices apply from their date onwards.
      </p>
      <Field label="Applies from" id="rfrom">
        <input
          id="rfrom"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      {items.length === 0 ? (
        <p className="muted">Nothing is on the menu yet, so there is nothing to price.</p>
      ) : null}
      <div className="pair">
        {items.map((it) => {
          const where = several ? servicesOffering(menus, it.id, from) : [];
          return (
            <div key={it.id} className="stack">
              <Field label={`${it.name} (₹ per ${it.unit})`} id={`r-${it.id}`}>
                <input
                  id={`r-${it.id}`}
                  inputMode="decimal"
                  required
                  value={fields.base[it.id] ?? ""}
                  onChange={(e) =>
                    setFields({ ...fields, base: { ...fields.base, [it.id]: e.target.value } })
                  }
                />
              </Field>
              {where.length > 1 ? (
                <details>
                  <summary>Different price in a service</summary>
                  <div className="stack">
                    {where.map((sv) => (
                      <Field
                        key={sv}
                        label={`${it.name} in ${serviceName(boot, sv)} (₹)`}
                        id={`r-${it.id}-${sv}`}
                        hint="Leave empty for the price above."
                      >
                        <input
                          id={`r-${it.id}-${sv}`}
                          inputMode="decimal"
                          value={fields.override[it.id]?.[sv] ?? ""}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              override: {
                                ...fields.override,
                                [it.id]: { ...fields.override[it.id], [sv]: e.target.value },
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
      <Field
        label="Monthly fee (₹)"
        id="r-fee"
        hint="Charged once a month when the rules say so. Zero for none."
      >
        <input
          id="r-fee"
          inputMode="decimal"
          value={fields.fee}
          onChange={(e) => setFields({ ...fields, fee: e.target.value })}
        />
      </Field>
      <Field label="Note (optional)" id="rnote">
        <input id="rnote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <button type="submit" className="btn" disabled={act.busy || items.length === 0}>
          Add prices
        </button>
      </div>
    </Form>
  );
}

function CardTable({ card }: { card: RateCard }) {
  const { boot } = useWorkspace();
  const several = boot.services.length >= 2;
  return (
    <div
      className="tablewrap"
      tabIndex={0}
      role="region"
      aria-label={`Prices from ${date(card.effectiveFrom)}; scrolls sideways when it is wider than the screen`}
    >
      <table>
        <thead>
          <tr>
            <th>Item</th>
            {several ? <th>In</th> : null}
            <th className="r">Price</th>
          </tr>
        </thead>
        <tbody>
          {card.prices.map((l) => (
            <tr key={`${l.itemId}-${l.serviceId}`}>
              <td>{itemName(boot, l.itemId)}</td>
              {several ? (
                <td>{l.serviceId ? serviceName(boot, l.serviceId) : "Every service"}</td>
              ) : null}
              <td className="r">{money(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <td>Monthly fee</td>
            {several ? <td /> : null}
            <td className="r">{money(card.monthlyFee)}</td>
          </tr>
        </tbody>
      </table>
      {card.note ? <p className="muted small">{card.note}</p> : null}
    </div>
  );
}

/** The prices of a kitchen that tracks money, newest first. */
export function Prices() {
  const ws = useWorkspace();
  const cards = useLoad(() => getJson<RateCard[]>(`${ws.api}/rate-cards`), [ws.api]);
  const menus = useLoad(() => getJson<MenuVersion[]>(`${ws.api}/menus`), [ws.api]);
  const [open, setOpen] = useState(false);
  const list = [...(cards.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return (
    <div className="stack" style={{ ["--gap" as string]: "24px" }}>
      <PageHead
        title="Prices"
        lead="What each meal and extra costs. What is served is on the menu."
      />
      <Problem error={cards.error ?? menus.error} />
      <section className="stack" aria-label="Rate cards">
        <SectionHead
          title="Rate cards"
          actions={
            <button
              type="button"
              className="btn small"
              disabled={!ws.writable || !menus.data}
              onClick={() => setOpen(true)}
            >
              New prices
            </button>
          }
        />
        {cards.loading && !cards.data ? <Spinner /> : null}
        {list.map((c, i) =>
          i === 0 ? (
            <div key={c.id} className="stack">
              <h3>From {date(c.effectiveFrom)}</h3>
              <CardTable card={c} />
            </div>
          ) : (
            <details key={c.id}>
              <summary>From {date(c.effectiveFrom)}</summary>
              <CardTable card={c} />
            </details>
          ),
        )}
        {list.length === 0 && !cards.loading ? (
          <p className="muted">No prices yet. Add prices to start billing.</p>
        ) : null}
      </section>
      <Dialog open={open} onClose={() => setOpen(false)} title="New prices">
        {open ? (
          <CardForm
            last={list[0] ?? null}
            menus={menus.data ?? []}
            onDone={() => {
              setOpen(false);
              cards.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
