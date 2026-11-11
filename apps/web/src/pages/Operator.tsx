import { useState } from "react";
import { Link } from "wouter";
import { api, getJson, postJson } from "../api.ts";
import { AppBar, Page, RequireSignIn } from "../components/Chrome.tsx";
import {
  Chip,
  Dialog,
  Field,
  Form,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../components/ui.tsx";

interface Limits {
  requestsPerDay: number;
  people: number;
  rows: number;
  bytes: number;
}
interface Row {
  id: string;
  slug: string;
  state: string;
  placement: string;
  createdAt: string;
  requestsToday: number;
  overSince: string | null;
  limits: Limits;
}
interface CapacityDetail {
  capacity: number;
  used: number;
  open: boolean;
  binding: string;
  dedicated: boolean;
  mode: "shared" | "dedicated";
  signup: "open" | "invite" | "closed";
  maxWorkspacesPerAccount: number | null;
  waiting: number;
  byProjects: number;
  byRequests: number;
  inputs: {
    hostProjects: number;
    reservedProjects: number;
    accountRequestsPerDay: number;
    headroom: number;
    perWorkspaceRequestsPerDay: number;
  };
  perWorkspaceFrom: "free limits" | "CAPACITY_JSON";
  maxima: Limits;
}
interface Listing {
  capacity: CapacityDetail;
  workspaces: Row[];
}
interface Signup {
  email: string;
  requestedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

const MB = 1024 * 1024;

const SIGNUP_WORDS = {
  open: "open: anyone signed in may start a kitchen",
  invite: "by invitation: only approved emails may start a kitchen",
  closed: "closed: no one may start a kitchen",
} as const;

/** What the instance can hold, and how: the sum behind the number of places, laid open. */
function CapacityFigures({ c }: { c: CapacityDetail }) {
  const i = c.inputs;
  return (
    <section className="card stack" aria-labelledby="cap-h">
      <h2 id="cap-h">Capacity</h2>
      <p>
        {c.mode === "dedicated" ? (
          <>This is a dedicated instance: it has no free places to run out of.</>
        ) : (
          <>
            {c.used} of {c.capacity} free places used · {c.open ? "open" : "full"} · held back by{" "}
            {c.binding}
          </>
        )}
      </p>
      <dl className="muted small">
        <dt>Mode</dt>
        <dd>{c.mode}</dd>
        <dt>Signup</dt>
        <dd>{SIGNUP_WORDS[c.signup]}</dd>
        <dt>Kitchens one account may start</dt>
        <dd>{c.maxWorkspacesPerAccount ?? "no limit"}</dd>
        {c.mode === "shared" ? (
          <>
            <dt>By the host's projects</dt>
            <dd>
              {c.byProjects} ({i.hostProjects} projects less {i.reservedProjects} kept back)
            </dd>
            <dt>By the host's daily requests</dt>
            <dd>
              {c.byRequests} ({i.accountRequestsPerDay.toLocaleString("en-IN")} a day,{" "}
              {i.headroom * 100}% kept for the system, over {i.perWorkspaceRequestsPerDay} a
              kitchen)
            </dd>
            <dt>The per-kitchen figure comes from</dt>
            <dd>
              {c.perWorkspaceFrom === "CAPACITY_JSON"
                ? "CAPACITY_JSON, stated on purpose"
                : "the free limits in force (FREE_LIMITS_JSON)"}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function SignupSection({ mode, onChange }: { mode: string; onChange: () => void }) {
  const list = useLoad(() => getJson<{ requests: Signup[] }>("/api/platform/signups"), []);
  const act = useAction();
  const [email, setEmail] = useState("");
  const approve = (e: string) =>
    act.run(async () => {
      await postJson("/api/platform/signups/approve", { email: e });
      toast("Approved.");
      setEmail("");
      list.reload();
      onChange();
    });
  const requests = list.data?.requests ?? [];
  return (
    <section className="card stack" aria-labelledby="signup-h">
      <h2 id="signup-h">Places asked for</h2>
      {mode !== "invite" ? (
        <p className="muted">
          Signup here is {mode}, so no one needs approving. Approvals made now are kept for if it is
          set to invitation.
        </p>
      ) : (
        <p className="muted">
          An approval lets that email start kitchens, up to the limit for one account. It is not
          used up.
        </p>
      )}
      <Problem error={act.error ?? list.error} />
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data && requests.length === 0 ? <p className="muted">No one has asked yet.</p> : null}
      {requests.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Asked</th>
                <th>Approved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.email}>
                  <td>{r.email}</td>
                  <td>{r.requestedAt ? r.requestedAt.slice(0, 10) : "-"}</td>
                  <td>
                    {r.approvedAt ? r.approvedAt.slice(0, 10) : <Chip tone="warn">Waiting</Chip>}
                  </td>
                  <td>
                    {r.approvedAt ? null : (
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={act.busy}
                        onClick={() => void approve(r.email)}
                      >
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Form error={null} onSubmit={() => approve(email)}>
        <Field label="Approve an email in advance" id="pre-email" hint="Before they have asked.">
          <input
            id="pre-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn small" disabled={act.busy}>
          Approve
        </button>
      </Form>
    </section>
  );
}

/** Changes what one kitchen may use. Lowering a limit below what it holds deletes nothing. */
function LimitsDialog({
  row,
  maxima,
  external,
  onClose,
  onDone,
}: {
  row: Row | null;
  maxima: Limits;
  external: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const act = useAction();
  const [vals, setVals] = useState<Record<keyof Limits, string> | null>(null);
  const [for_, setFor] = useState<string | null>(null);
  if (row && for_ !== row.id) {
    setFor(row.id);
    setVals({
      people: String(row.limits.people),
      rows: String(row.limits.rows),
      requestsPerDay: String(row.limits.requestsPerDay),
      bytes: String(Math.round(row.limits.bytes / MB)),
    });
  }
  const set = (k: keyof Limits) => (e: { target: { value: string } }) =>
    setVals((v) => (v ? { ...v, [k]: e.target.value } : v));
  const field = (k: keyof Limits, label: string, max: number, hint?: string) => (
    <Field label={label} id={`lim-${k}`} hint={hint ?? `Up to ${max.toLocaleString("en-IN")}`}>
      <input
        id={`lim-${k}`}
        type="number"
        required
        min={1}
        max={max}
        step={1}
        disabled={external && k !== "requestsPerDay"}
        value={vals?.[k] ?? ""}
        onChange={set(k)}
      />
    </Field>
  );
  return (
    <Dialog open={!!row} onClose={onClose} title={row ? `Edit limits: ${row.slug}` : "Edit limits"}>
      {row && vals ? (
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const body: Partial<Limits> = {
                requestsPerDay: Number(vals.requestsPerDay),
              };
              if (!external) {
                body.people = Number(vals.people);
                body.rows = Number(vals.rows);
                body.bytes = Number(vals.bytes) * MB;
              }
              await postJson(`/api/platform/workspaces/${row.slug}/limits`, body);
              toast("Limits saved.");
              onDone();
              onClose();
            })
          }
        >
          <p className="muted small">
            Lowering a limit below what the kitchen already holds deletes nothing. The kitchen is
            shown as over its limit, and after the grace days can still read and take a copy of its
            data but not add to it.
            {external
              ? " This kitchen runs on its own database, so only its requests a day can be set."
              : ""}
          </p>
          {field("people", "People", maxima.people)}
          {field("rows", "Records", maxima.rows)}
          {field("requestsPerDay", "Requests a day", maxima.requestsPerDay)}
          {field("bytes", "Storage (MB)", Math.floor(maxima.bytes / MB))}
          <div className="row">
            <button type="submit" className="btn" disabled={act.busy}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </Form>
      ) : null}
    </Dialog>
  );
}

export function Operator() {
  const list = useLoad(() => getJson<Listing>("/api/platform/workspaces"), []);
  const act = useAction();
  const [editing, setEditing] = useState<Row | null>(null);
  const tone = (s: string) => (s === "ACTIVE" ? "good" : s === "WIPING" ? "bad" : "warn");
  return (
    <>
      <AppBar />
      <RequireSignIn>
        <Page
          title="Operator"
          actions={
            <button
              type="button"
              className="btn ghost small"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  const r = await postJson<Record<string, unknown>>("/api/platform/housekeeping");
                  toast(`Housekeeping done: ${JSON.stringify(r).slice(0, 120)}`);
                  list.reload();
                })
              }
            >
              Run housekeeping
            </button>
          }
        >
          <Problem error={act.error ?? list.error} />
          {list.loading && !list.data ? <Spinner /> : null}
          {list.data ? (
            <>
              <CapacityFigures c={list.data.capacity} />
              <SignupSection mode={list.data.capacity.signup} onChange={list.reload} />
              <div
                className="tablewrap"
                tabIndex={0}
                role="region"
                aria-label="Table; scrolls sideways when it is wider than the screen"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>State</th>
                      <th>Where</th>
                      <th className="r">Requests today</th>
                      <th>Over since</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.workspaces.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <Link href={`/w/${w.slug}`}>{w.slug}</Link>
                        </td>
                        <td>
                          <Chip tone={tone(w.state)}>{w.state}</Chip>
                        </td>
                        <td>{w.placement}</td>
                        <td className="r">
                          {w.requestsToday} / {w.limits.requestsPerDay}
                        </td>
                        <td>{w.overSince ?? "-"}</td>
                        <td>
                          <div className="row">
                            {w.state === "ACTIVE" && !list.data?.capacity.dedicated ? (
                              <button
                                type="button"
                                className="btn ghost small"
                                onClick={() => setEditing(w)}
                              >
                                Edit limits
                              </button>
                            ) : null}
                            {w.state === "MIGRATING" ? (
                              <button
                                type="button"
                                className="btn ghost small"
                                onClick={() =>
                                  void act.run(async () => {
                                    await api.post(`/api/platform/workspaces/${w.slug}/release`);
                                    toast("Released: writing is open again.");
                                    list.reload();
                                  })
                                }
                              >
                                Release
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <LimitsDialog
                row={editing}
                maxima={list.data.capacity.maxima}
                external={editing?.placement === "external"}
                onClose={() => setEditing(null)}
                onDone={list.reload}
              />
            </>
          ) : null}
        </Page>
      </RequireSignIn>
    </>
  );
}
