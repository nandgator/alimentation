import type { OrganisationDto, OrganisationKitchenDto } from "@alimentation/core";
import { must } from "@alimentation/core";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { api, getJson, postJson } from "../api.ts";
import { AppBar, Page, RequireSignIn } from "../components/Chrome.tsx";
import {
  Chip,
  CopyButton,
  Field,
  Form,
  Problem,
  Spinner,
  Tile,
  toast,
  useAction,
  useLoad,
} from "../components/ui.tsx";
import { money, month as monthLabel } from "../format.ts";
import { sumOrganisation } from "../kitchens.ts";
import { useSession } from "../session.tsx";

const WHY: Record<NonNullable<OrganisationKitchenDto["unavailable"]>, string> = {
  moved: "Has moved",
  busy: "Has used its requests for today",
  unreadable: "Could not be read just now",
};

function Totals({ kitchens }: { kitchens: OrganisationKitchenDto[] }) {
  const sum = sumOrganisation(kitchens);
  if (!sum)
    return (
      <p className="muted">
        {kitchens.length === 0
          ? "No kitchen shares its totals with this organisation yet."
          : "There are no figures to add up: the kitchens cannot be read."}
      </p>
    );
  return (
    <div className="tilegroups">
      {sum.money ? (
        <div className="tiles lead">
          <Tile lead label="Billed" value={money(sum.money.billed)} />
          <Tile lead label="Paid" value={money(sum.money.paid)} />
          <Tile lead label="Owed" value={money(sum.money.owed)} />
        </div>
      ) : null}
      <div className={sum.money ? "tiles" : "tiles lead"}>
        <Tile lead={!sum.money} label="People fed" value={sum.consumers} />
        <Tile lead={!sum.money} label="Meals" value={sum.meals} />
        {sum.money ? <Tile label="To confirm" value={sum.money.toConfirm || "-"} /> : null}
        <Tile label="Not set up" value={sum.setup || "-"} />
      </div>
      {sum.mealsOnly > 0 ? (
        <p className="muted small">
          {sum.mealsOnly} kitchen{sum.mealsOnly === 1 ? " does" : "s do"} not track money, so{" "}
          {sum.mealsOnly === 1 ? "it is" : "they are"} in the counts and not in the money.
        </p>
      ) : null}
      {sum.unread === 0 && !sum.money && sum.counted > sum.mealsOnly ? (
        <p className="muted small">
          The money is left out because the kitchens that track it keep their books in different
          currencies.
        </p>
      ) : null}
      {sum.unread > 0 ? (
        <p className="muted small">
          {sum.unread} kitchen{sum.unread === 1 ? "" : "s"} could not be read and{" "}
          {sum.unread === 1 ? "is" : "are"} not in these figures.
        </p>
      ) : null}
    </div>
  );
}

function Kitchens({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  // Columns of money are there when at least one kitchen can fill them.
  const anyMoney = data.kitchens.some((k) => k.totals?.moneyEnabled !== false);
  const act = useAction();
  const mine = new Set((me?.workspaces ?? []).map((w) => w.slug));
  return (
    <section className="stack" aria-labelledby="kitchens-h">
      <h2 id="kitchens-h">Kitchens</h2>
      <Problem error={act.error} />
      {data.kitchens.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Kitchen</th>
                <th className="r">People</th>
                <th className="r">Meals</th>
                {anyMoney ? (
                  <>
                    <th className="r">Billed</th>
                    <th className="r">Paid</th>
                    <th className="r">Owed</th>
                    <th className="r">To confirm</th>
                  </>
                ) : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.kitchens.map((k) => (
                <tr key={k.slug}>
                  <td>
                    {mine.has(k.slug) ? <Link href={`/w/${k.slug}`}>{k.name}</Link> : k.name}
                    {k.totals ? (
                      <div className="muted small">
                        {monthLabel(k.totals.month)}
                        {k.totals.setup > 0 ? (
                          <>
                            {" "}
                            <Chip tone="warn">Needs setting up</Chip>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  {k.totals ? (
                    <>
                      <td className="r">{k.totals.consumers}</td>
                      <td className="r">{k.totals.meals}</td>
                      {k.totals.moneyEnabled ? (
                        <>
                          <td className="r">{money(k.totals.billed)}</td>
                          <td className="r">{money(k.totals.paid)}</td>
                          <td className="r">{money(k.totals.owed)}</td>
                          <td className="r">{k.totals.toConfirm || "-"}</td>
                        </>
                      ) : anyMoney ? (
                        <td colSpan={4} className="muted">
                          Does not track money
                        </td>
                      ) : null}
                    </>
                  ) : (
                    <td colSpan={anyMoney ? 6 : 2} className="muted">
                      {k.unavailable ? WHY[k.unavailable] : ""}
                    </td>
                  )}
                  <td className="r">
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={act.busy}
                      onClick={() =>
                        void act.run(async () => {
                          await api.del(
                            `/api/organisations/${data.organisation.id}/kitchens/${k.slug}`,
                          );
                          toast(`${k.name} no longer shares its totals.`);
                          onChange();
                        })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function AddKitchen({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  const act = useAction();
  const [slug, setSlug] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const already = new Set(data.kitchens.map((k) => k.slug));
  const mine = (me?.workspaces ?? []).filter(
    (w) => w.state === "ACTIVE" && w.roles.includes("admin") && !already.has(w.slug),
  );
  return (
    <section className="card stack" aria-labelledby="add-h">
      <h2 id="add-h">Add a kitchen</h2>
      {mine.length > 0 ? (
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              await postJson(`/api/organisations/${data.organisation.id}/kitchens`, {
                slug: slug || must(mine[0]).slug,
              });
              setSlug("");
              onChange();
            })
          }
        >
          <Field label="A kitchen you run" id="add-kitchen">
            <select
              id="add-kitchen"
              value={slug || must(mine[0]).slug}
              onChange={(e) => setSlug(e.target.value)}
            >
              {mine.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn" disabled={act.busy}>
            Add it
          </button>
        </Form>
      ) : (
        <p className="muted">There is no other kitchen of yours to add.</p>
      )}
      <hr />
      <p>
        <strong>A kitchen someone else runs.</strong> Make a link and send it to its admin. They
        paste it under <em>Your data</em> in that kitchen, see that it is for{" "}
        {data.organisation.name}, and choose to share. It works for seven days.
      </p>
      <div>
        <button
          type="button"
          className="btn ghost"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              const r = await postJson<{ token: string }>(
                `/api/organisations/${data.organisation.id}/join-links`,
              );
              setLink(r.token);
            })
          }
        >
          Make a link
        </button>
      </div>
      {link ? (
        <Field label="The link" id="join-link" hint="Select it all and copy it.">
          <span className="row" style={{ ["--gap" as string]: "var(--space-2)" }}>
            <input id="join-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={link} label="Copy the link" />
          </span>
        </Field>
      ) : null}
    </section>
  );
}

function HeadOffice({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  const act = useAction();
  const [email, setEmail] = useState("");
  return (
    <section className="card stack" aria-labelledby="people-h">
      <h2 id="people-h">Head office</h2>
      <p className="muted">
        These people see the totals above. They see no names, and they are not members of any
        kitchen because of this.
      </p>
      <ul className="plain-list">
        {data.members.map((m) => (
          <li key={m.accountId}>
            {m.name ?? m.email}
            {m.name ? <span className="muted"> · {m.email}</span> : null}{" "}
            {data.members.length > 1 ? (
              <button
                type="button"
                className="btn ghost small"
                disabled={act.busy}
                onClick={() =>
                  void act.run(async () => {
                    await api.del(
                      `/api/organisations/${data.organisation.id}/members/${m.accountId}`,
                    );
                    onChange();
                  })
                }
              >
                {m.accountId === me?.account?.id ? "Leave" : "Remove"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            await postJson(`/api/organisations/${data.organisation.id}/members`, { email });
            setEmail("");
            onChange();
          })
        }
      >
        <Field label="Add someone" id="member-email" hint="They must have signed in here once.">
          <input
            id="member-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn ghost" disabled={act.busy}>
          Add
        </button>
      </Form>
    </section>
  );
}

export function Organisation() {
  const { id = "" } = useParams();
  const list = useLoad(() => getJson<OrganisationDto>(`/api/organisations/${id}`), [id]);
  return (
    <>
      <AppBar />
      <RequireSignIn>
        <Page title={list.data?.organisation.name ?? "Organisation"}>
          <p>
            <Link href="/app">← Your kitchens</Link>
          </p>
          <Problem
            error={
              list.error
                ? list.error.status === 404
                  ? "There is no such organisation, or you are not in its head office."
                  : list.error
                : null
            }
          />
          {list.loading && !list.data ? <Spinner /> : null}
          {list.data ? (
            <div className="stack" style={{ ["--gap" as string]: "var(--space-5)" }}>
              <p className="muted">
                Each kitchen's totals for its month: how many people, how many meals, what was
                billed, paid and is owed. Nothing here names anyone.
              </p>
              <Totals kitchens={list.data.kitchens} />
              <Kitchens data={list.data} onChange={list.reload} />
              <AddKitchen data={list.data} onChange={list.reload} />
              <HeadOffice data={list.data} onChange={list.reload} />
            </div>
          ) : null}
        </Page>
      </RequireSignIn>
    </>
  );
}
