import { useState } from "react";
import type { BootstrapDto, IsoDate, RateCard } from "@alimentation/core";
import { api, getJson, postJson } from "../api.ts";
import { Chip, Field, Form, Problem, toast, useAction } from "../components/ui.tsx";
import {
  applyPlan,
  planCopy,
  type Outcome,
  type Plan,
  type Snapshot,
  type What,
} from "../copySetup.ts";

interface Kitchen {
  slug: string;
  name: string;
}

/** What a kitchen says about its prices, rules and holidays, to someone who is its admin. */
async function snapshot(slug: string): Promise<Snapshot> {
  const base = `/api/w/${slug}`;
  const [boot, rateCards, policies] = await Promise.all([
    api.get<BootstrapDto>(`${base}/bootstrap`),
    getJson<RateCard[]>(`${base}/rate-cards`),
    getJson<{ effectiveFrom: IsoDate; doc: unknown }[]>(`${base}/policies`),
  ]);
  return {
    today: boot.data.today,
    rateCards,
    policies,
    holidays: boot.data.holidays,
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Summary({ plan }: { plan: Plan }) {
  const kinds = {
    rules: plan.steps.filter((s) => s.kind === "rules").length,
    prices: plan.steps.filter((s) => s.kind === "prices").length,
    holiday: plan.steps.filter((s) => s.kind === "holiday").length,
  };
  const parts = [
    kinds.prices ? count(kinds.prices, "price list") : "",
    kinds.rules ? count(kinds.rules, "set of rules", "sets of rules") : "",
    kinds.holiday ? count(kinds.holiday, "holiday") : "",
  ].filter(Boolean);
  return (
    <div className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
      <p>
        {plan.steps.length === 0 ? "Nothing to add." : `Will add ${parts.join(", ")}.`}{" "}
        {plan.already > 0 ? <span className="muted">{plan.already} already the same.</span> : null}
      </p>
      {plan.steps.length > 0 ? (
        <ul className="plain-list small muted">
          {plan.steps.map((s) => (
            <li key={`${s.kind}-${s.label}`}>{s.label}</li>
          ))}
        </ul>
      ) : null}
      {plan.left.length > 0 ? (
        <div className="banner warn">
          <p>Left as they are, because that kitchen has something different there:</p>
          <ul className="plain-list small">
            {plan.left.map((l) => (
              <li key={l.label}>
                {l.label}: {l.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
    </div>
  );
}

/**
 * Prices, rules and holidays from one kitchen to others, for someone who runs them all. It shows what would
 * be added before anything is, and adds it through each kitchen's own pages, so each kitchen still refuses
 * what its own rules refuse and the people in it are told nothing.
 */
export function CopySetup({ kitchens }: { kitchens: Kitchen[] }) {
  const [from, setFrom] = useState(kitchens[0]!.slug);
  const [to, setTo] = useState<Set<string>>(new Set());
  const [what, setWhat] = useState<What>({ prices: true, rules: true, holidays: true });
  const [plans, setPlans] = useState<Record<string, Plan> | null>(null);
  const [done, setDone] = useState<Record<string, Outcome> | null>(null);
  const check = useAction();
  const copy = useAction();
  const others = kitchens.filter((k) => k.slug !== from);
  const chosen = others.filter((k) => to.has(k.slug));
  const nameOf = (slug: string) => kitchens.find((k) => k.slug === slug)?.name ?? slug;
  const nothingChosen = !what.prices && !what.rules && !what.holidays;
  const anyToAdd = plans ? Object.values(plans).some((p) => p.steps.length > 0) : false;

  const forget = () => {
    setPlans(null);
    setDone(null);
  };

  return (
    <section className="card stack" aria-labelledby="copy-h">
      <h2 id="copy-h">Copy a setup to other kitchens</h2>
      <p className="muted">
        Take prices, rules and holidays from one kitchen you run and add them to others you run. You
        see what would be added first. Nothing already there is changed.
      </p>
      <Form
        error={check.error}
        onSubmit={() =>
          check.run(async () => {
            setDone(null);
            const source = await snapshot(from);
            const next: Record<string, Plan> = {};
            for (const k of chosen) next[k.slug] = planCopy(source, await snapshot(k.slug), what);
            setPlans(next);
          })
        }
      >
        <Field label="Copy from" id="copy-from">
          <select
            id="copy-from"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setTo(new Set());
              forget();
            }}
          >
            {kitchens.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
          <legend>Copy to</legend>
          {others.map((k) => (
            <label key={k.slug} className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
              <input
                type="checkbox"
                checked={to.has(k.slug)}
                onChange={(e) => {
                  const next = new Set(to);
                  if (e.target.checked) next.add(k.slug);
                  else next.delete(k.slug);
                  setTo(next);
                  forget();
                }}
              />
              <span>{k.name}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
          <legend>What to copy</legend>
          {(
            [
              ["prices", "Prices (the rate cards)"],
              ["rules", "Rules (working days, leave and the rest)"],
              ["holidays", "Holidays from this month on"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
              <input
                type="checkbox"
                checked={what[key]}
                onChange={(e) => {
                  setWhat({ ...what, [key]: e.target.checked });
                  forget();
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="btn"
          disabled={check.busy || chosen.length === 0 || nothingChosen}
        >
          {check.busy ? "Looking…" : "See what would be added"}
        </button>
      </Form>

      {plans ? (
        <div className="stack" aria-live="polite">
          {chosen.map((k) => (
            <div key={k.slug} className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
              <h3>{k.name}</h3>
              {plans[k.slug] ? <Summary plan={plans[k.slug]!} /> : null}
            </div>
          ))}
          <Problem error={copy.error} />
          <button
            type="button"
            className="btn"
            disabled={copy.busy || !anyToAdd}
            onClick={() =>
              void copy.run(async () => {
                const results: Record<string, Outcome> = {};
                for (const k of chosen) {
                  const plan = plans[k.slug];
                  if (plan && plan.steps.length > 0)
                    results[k.slug] = await applyPlan(
                      (path, body) => postJson(path, body),
                      `/api/w/${k.slug}`,
                      plan.steps,
                    );
                }
                setDone(results);
                setPlans(null);
                const added = Object.values(results).reduce((a, r) => a + r.added, 0);
                const refused = Object.values(results).reduce((a, r) => a + r.refused.length, 0);
                toast(
                  refused ? `Added ${added}; ${refused} refused.` : `Added ${added}.`,
                  refused ? "bad" : "good",
                );
              })
            }
          >
            {copy.busy ? "Copying…" : `Copy to ${count(chosen.length, "kitchen")}`}
          </button>
        </div>
      ) : null}

      {done ? (
        <div className="stack" aria-live="polite">
          {Object.entries(done).map(([slug, r]) => (
            <div key={slug} className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
              <h3>{nameOf(slug)}</h3>
              <p>
                <Chip tone="good">Added {r.added}</Chip>
                {r.refused.length > 0 ? <Chip tone="bad">{r.refused.length} refused</Chip> : null}
              </p>
              {r.refused.length > 0 ? (
                <ul className="plain-list small">
                  {r.refused.map((x) => (
                    <li key={x.label}>
                      {x.label}: {x.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
