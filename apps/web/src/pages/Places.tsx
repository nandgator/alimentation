import type { BootstrapDto } from "@alimentation/core";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { api, type Capacity, getJson, postJson } from "../api.ts";
import { AppBar, Page, RequireSignIn } from "../components/Chrome.tsx";
import { Chip, Field, Form, Problem, Tile, toast, useAction } from "../components/ui.tsx";
import { money } from "../format.ts";
import { figuresOf, isRunning, type KitchenFigures, totalsOf } from "../kitchens.ts";
import { useSession } from "../session.tsx";

// Needed only by someone who runs several kitchens, so everyone else does not download it.
const ManyKitchens = lazy(() =>
  import("./ManyKitchens.tsx").then((m) => ({ default: m.ManyKitchens })),
);

type Found = Record<string, KitchenFigures | "failed">;

/**
 * Asks each of the person's kitchens, a few at a time, what it would tell them on opening it. Each question
 * is an ordinary request as that person in that kitchen, so a kitchen answers only what it would anyway, and
 * counts the request against its own budget.
 */
function useFigures(slugs: string[]): Found {
  const [found, setFound] = useState<Found>({});
  const key = slugs.join(",");
  useEffect(() => {
    let live = true;
    const queue = key ? key.split(",") : [];
    const worker = async () => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        const mine = slug;
        const result = await api.get<BootstrapDto>(`/api/w/${mine}/bootstrap`).then(
          (r) => figuresOf(r.data, r.fromDevice),
          () => "failed" as const,
        );
        if (live) setFound((f) => ({ ...f, [mine]: result }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return () => {
      live = false;
    };
  }, [key]);
  return found;
}

function Figures({ f }: { f: KitchenFigures | "failed" | undefined }) {
  if (f === undefined) return <p className="muted small">Reading the figures…</p>;
  if (f === "failed") return <p className="muted small">The figures could not be read just now.</p>;
  const h = f.headline;
  if (!f.moneyEnabled)
    return (
      <p className="row small" style={{ ["--gap" as string]: "var(--space-3)" }}>
        <span>{f.meals} meals this month</span>
        {f.setup > 0 ? <Chip tone="warn">Needs setting up</Chip> : null}
        {f.fromDevice ? <Chip>Saved on this device</Chip> : null}
      </p>
    );
  return (
    <p className="row small" style={{ ["--gap" as string]: "var(--space-3)" }}>
      {isRunning(f.role) ? (
        <span>{h.owed > 0 ? `${money(h.owed)} owed` : "Nothing owed"}</span>
      ) : (
        <span>{h.owed > 0 ? `You owe ${money(h.owed)}` : "You owe nothing"}</span>
      )}
      {isRunning(f.role) && h.toConfirm > 0 ? (
        <Chip tone="warn">{h.toConfirm} to confirm</Chip>
      ) : null}
      {f.setup > 0 ? <Chip tone="warn">Needs setting up</Chip> : null}
      {f.fromDevice ? <Chip>Saved on this device</Chip> : null}
    </p>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Where kitchens are by invitation: what that means, and a way to ask. */
function AskForAPlace({ requested }: { requested: boolean }) {
  const { refresh } = useSession();
  const act = useAction();
  return (
    <div className="stack" style={{ ["--gap" as string]: "var(--space-3)" }}>
      <p>
        New kitchens here are by invitation, to keep the service from filling up. Ask for a place
        with the email you signed in with, and whoever runs the service will approve it. Come back
        here once they have: this page will then let you start your kitchen.
      </p>
      {requested ? (
        <div className="banner info" role="status">
          You have asked for a place. There is nothing more to do until it is approved.
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              await postJson("/api/waitlist");
              await refresh();
              toast("Asked. You will be able to start a kitchen once it is approved.");
            })
          }
        >
          Ask for a place
        </button>
      )}
      <Problem error={act.error} />
    </div>
  );
}

function NewKitchen({ cap }: { cap: Capacity | null }) {
  const [, go] = useLocation();
  const { me, refresh } = useSession();
  const refusal = me?.signup?.refusal ?? null;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [supplier, setSupplier] = useState(true);
  // Whether the kitchen puts a price on its meals. Chosen here and never changed, so it is asked here.
  const moneyAllowed = me?.moneyAllowed !== false;
  const [track, setTrack] = useState(true);
  const act = useAction();
  return (
    <section className="card stack" aria-labelledby="new-h">
      <h2 id="new-h">Start a kitchen</h2>
      {refusal === "closed" ? (
        <div className="banner info">
          This service is not taking new kitchens right now. You can run your own instance and move
          in later.
        </div>
      ) : refusal === "invite_only" ? (
        <AskForAPlace requested={me?.signup?.requested ?? false} />
      ) : refusal === "limit" ? (
        <div className="banner info">
          You already have the most kitchens one account can start here ({me?.signup?.maxWorkspaces}
          ). Delete one you no longer use, or run your own instance and move in.
        </div>
      ) : null}
      {refusal === null && cap && !cap.dedicated && !cap.open ? (
        <div className="banner warn">
          The free places are full for now. You can try again later, or run your own instance and
          move in.
        </div>
      ) : null}
      {refusal === null ? (
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const made = await postJson<{ slug: string }>("/api/workspaces", {
                slug,
                name,
                alsoSupplier: supplier,
                moneyEnabled: moneyAllowed ? track : false,
              });
              await refresh();
              go(`/w/${made.slug}`);
            })
          }
        >
          <Field label="Name" id="kname" hint="What your people call it.">
            <input
              id="kname"
              required
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!touched) setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <Field
            label="Address"
            id="kslug"
            hint="Letters, numbers and dashes. This is what the link will say: /w/…"
          >
            <input
              id="kslug"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
              value={slug}
              onChange={(e) => {
                setTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
            <input
              type="checkbox"
              checked={supplier}
              onChange={(e) => setSupplier(e.target.checked)}
            />
            <span>I also cook for them (add me as the supplier too)</span>
          </label>
          {moneyAllowed ? (
            <fieldset className="stack" style={{ ["--gap" as string]: "var(--space-2)" }}>
              <legend>Prices and bills</legend>
              <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
                <input
                  type="checkbox"
                  checked={track}
                  onChange={(e) => setTrack(e.target.checked)}
                  aria-describedby="track-hint"
                />
                <span>Track money in this kitchen</span>
              </label>
              <p id="track-hint" className="muted small">
                {track
                  ? "You set prices, each person gets a bill each month, and payments are recorded and confirmed. "
                  : "The kitchen only counts meals: who ate, who was on leave, and the extras as numbers. There are no prices, bills or payments. "}
                You choose this once, now. It cannot be changed later.
              </p>
            </fieldset>
          ) : (
            <p className="muted small">
              This service keeps kitchens to counting meals. There are no prices, bills or payments
              here.
            </p>
          )}
          <button
            type="submit"
            className="btn"
            disabled={act.busy || (cap ? !cap.open && !cap.dedicated : false)}
          >
            Create
          </button>
        </Form>
      ) : null}
    </section>
  );
}

export function Places() {
  const { me } = useSession();
  const [cap, setCap] = useState<Capacity | null>(null);
  useEffect(() => {
    getJson<Capacity>("/api/public/capacity").then(setCap, () => setCap(null));
  }, []);
  const list = me?.workspaces ?? [];
  const active = list.filter((w) => w.state === "ACTIVE");
  const adminOf = active.filter((w) => w.roles.includes("admin"));
  const organisations = me?.organisations ?? [];
  // Figures beside each kitchen are for someone with several of them. With one there is nothing to compare,
  // so nothing is asked of it here, and it is asked once, when it is opened.
  const several = active.length >= 2;
  const figures = useFigures(several ? active.map((w) => w.slug) : []);
  const counted = Object.values(figures).filter((f): f is KitchenFigures => f !== "failed");
  const totals =
    several && counted.length === Object.keys(figures).length && counted.length === active.length
      ? totalsOf(counted)
      : null;
  const runsMany = adminOf.length >= 2 || organisations.length > 0 || !!me?.operator;
  return (
    <>
      <AppBar>
        {me?.operator ? (
          <Link href="/operator" className="btn ghost small">
            Operator
          </Link>
        ) : null}
      </AppBar>
      <RequireSignIn>
        <Page title="Your kitchens">
          {list.length === 0 && organisations.length === 0 ? (
            <p className="muted">
              You are not in any kitchen yet. Start one below, or open the invitation link someone
              sent you.
            </p>
          ) : list.length === 0 ? null : (
            <div className="stack" style={{ ["--gap" as string]: "var(--space-4)" }}>
              {totals ? (
                <section className="stack" aria-labelledby="across-h">
                  <h2 id="across-h" className="muted small">
                    Across your {counted.length} kitchens
                  </h2>
                  <div className="tiles">
                    {totals.running.kitchens > 0 ? (
                      <>
                        <Tile label="Owed to your kitchens" value={money(totals.running.owed)} />
                        <Tile label="To confirm" value={totals.running.toConfirm || "-"} />
                      </>
                    ) : null}
                    {totals.owe.kitchens > 0 ? (
                      <Tile label="You owe" value={money(totals.owe.amount)} />
                    ) : null}
                  </div>
                </section>
              ) : null}
              <ul className="stack card-list" style={{ ["--gap" as string]: "var(--space-3)" }}>
                {list.map((w) => (
                  <li key={w.slug}>
                    <div className="card row between">
                      <div>
                        <h3>{w.name}</h3>
                        <p className="muted small">
                          /w/{w.slug} · {w.roles.join(", ")}
                        </p>
                        {several && w.state === "ACTIVE" ? <Figures f={figures[w.slug]} /> : null}
                      </div>
                      <div className="row">
                        {w.state === "MOVED" ? <Chip tone="warn">Moved</Chip> : null}
                        {w.state === "MIGRATING" ? <Chip tone="warn">Moving</Chip> : null}
                        {w.state === "MOVED" && w.movedTo ? (
                          <a className="btn small" href={w.movedTo}>
                            Open at its new address
                          </a>
                        ) : (
                          <Link className="btn small" href={`/w/${w.slug}`}>
                            Open
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {organisations.length > 0 ? (
            <section className="stack" aria-labelledby="head-office-h">
              <h2 id="head-office-h">Head office</h2>
              <ul className="stack card-list" style={{ ["--gap" as string]: "var(--space-3)" }}>
                {organisations.map((o) => (
                  <li key={o.id}>
                    <div className="card row between">
                      <div>
                        <h3>{o.name}</h3>
                        <p className="muted small">
                          {o.kitchens === 0
                            ? "No kitchen shares its totals yet"
                            : `${o.kitchens} kitchen${o.kitchens === 1 ? "" : "s"} share their totals`}
                        </p>
                      </div>
                      <Link className="btn small" href={`/org/${o.id}`}>
                        Open
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {runsMany ? (
            <Suspense fallback={null}>
              <ManyKitchens kitchens={adminOf} organisations={organisations.length} />
            </Suspense>
          ) : null}
          {cap?.dedicated && !me?.operator ? (
            <div className="banner info">
              This is a private instance. Ask whoever runs it to add a kitchen for you.
            </div>
          ) : (
            <NewKitchen cap={cap} />
          )}
        </Page>
      </RequireSignIn>
    </>
  );
}
