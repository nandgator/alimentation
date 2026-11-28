import { useState } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { api, postJson } from "@/api";
import {
  AppForm,
  CountInput,
  DataTable,
  EmptyState,
  FormDialog,
  FormField,
  NotAvailable,
  PageHeader,
  PageSkeleton,
  StatusBadge,
  SubmitButton,
  toast,
  useAppForm,
} from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlState } from "@/hooks";
import { useSession } from "../session.tsx";
import { OutsideLayout, SignedIn } from "./outside/Layout.tsx";
import { LoadProblem, useLoad } from "./outside/parts.tsx";
import { ActionProblem, useRun } from "./workspace/books/parts.tsx";

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
  /** Where the kitchen's older months stand: a state, a date and counts, never what they hold. */
  retention: {
    state: "none" | "due" | "offered" | "overdue";
    retainedFrom: string | null;
    liveBytes: number;
    liveRows: number;
    cuts: number;
    restored: boolean;
  };
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
  const rows: [string, string | number][] = [
    ["Mode", c.mode],
    ["Signup", SIGNUP_WORDS[c.signup]],
    ["Kitchens one account may start", c.maxWorkspacesPerAccount ?? "no limit"],
  ];
  if (c.mode === "shared")
    rows.push(
      [
        "By the host's projects",
        `${c.byProjects} (${i.hostProjects} projects less ${i.reservedProjects} kept back)`,
      ],
      [
        "By the host's daily requests",
        `${c.byRequests} (${i.accountRequestsPerDay.toLocaleString("en-IN")} a day, ${i.headroom * 100}% kept for the system, over ${i.perWorkspaceRequestsPerDay} a kitchen)`,
      ],
      [
        "The per-kitchen figure comes from",
        c.perWorkspaceFrom === "CAPACITY_JSON"
          ? "CAPACITY_JSON, stated on purpose"
          : "the free limits in force (FREE_LIMITS_JSON)",
      ],
    );
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Capacity</h2>
        <CardDescription>
          {c.mode === "dedicated" ? (
            <>This is a dedicated instance: it has no free places to run out of.</>
          ) : (
            <>
              {c.used} of {c.capacity} free places used · {c.open ? "open" : "full"} · held back by{" "}
              {c.binding}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* design: a term column that is never wider than 14rem, over the rest */}
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

const emailSchema = z.object({
  email: z.string().trim().min(1, "Enter an email").email("That does not look like an email"),
});

function Signups({ mode, onChange }: { mode: string; onChange: () => void }) {
  const list = useLoad<{ requests: Signup[] }>("/api/platform/signups");
  const approving = useRun();
  const form = useAppForm(emailSchema, { email: "" });
  const approve = async (email: string) => {
    await postJson("/api/platform/signups/approve", { email });
    toast.success("Approved.");
    list.reload();
    onChange();
  };
  const requests = list.data?.requests ?? [];
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        {mode !== "invite"
          ? `Signup here is ${mode}, so no one needs approving. Approvals made now are kept for if it is set to invitation.`
          : "An approval lets that email start kitchens, up to the limit for one account. It is not used up."}
      </p>
      <LoadProblem error={list.error} onRetry={list.reload} />
      <ActionProblem error={approving.error} />
      <PageSkeleton loading={list.loading} variant="table">
        {list.data ? (
          <DataTable
            data={requests}
            getRowId={(r) => r.email}
            caption="Places asked for"
            searchLabel="Search emails"
            empty={
              <EmptyState
                title="No one has asked yet"
                description="Someone who asks for a place appears here, waiting for you."
              />
            }
            columns={[
              {
                id: "email",
                header: "Email",
                sort: (r) => r.email,
                search: (r) => r.email,
                cell: (r) => r.email,
              },
              {
                id: "asked",
                header: "Asked",
                sort: (r) => r.requestedAt,
                cell: (r) => (r.requestedAt ? r.requestedAt.slice(0, 10) : "-"),
              },
              {
                id: "approved",
                header: "Approved",
                sort: (r) => r.approvedAt,
                cell: (r) =>
                  r.approvedAt ? (
                    r.approvedAt.slice(0, 10)
                  ) : (
                    <StatusBadge status="pending" label="Waiting" />
                  ),
              },
              {
                id: "approve",
                header: "Approve",
                cell: (r) =>
                  r.approvedAt ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={approving.busy}
                      aria-label={`Approve ${r.email}`}
                      onClick={() => void approving.run(() => approve(r.email))}
                    >
                      Approve
                    </Button>
                  ),
              },
            ]}
            mobile={{
              title: (r) => r.email,
              description: (r) =>
                r.requestedAt ? `Asked ${r.requestedAt.slice(0, 10)}` : "Not asked yet",
              trailing: (r) =>
                r.approvedAt ? (
                  <StatusBadge status="confirmed" label="Approved" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={approving.busy}
                    aria-label={`Approve ${r.email}`}
                    onClick={() => void approving.run(() => approve(r.email))}
                  >
                    Approve
                  </Button>
                ),
            }}
          />
        ) : null}
      </PageSkeleton>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Approve an email in advance</h2>
          <CardDescription>Before they have asked.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppForm
            form={form}
            onSubmit={async (v) => {
              await approve(v.email);
              form.reset();
            }}
          >
            <FormField name="email" label="Email" required>
              {(f) => (
                <Input
                  {...f}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </FormField>
            <SubmitButton busy="Approving…" className="self-start">
              Approve
            </SubmitButton>
          </AppForm>
        </CardContent>
      </Card>
    </div>
  );
}

const limit = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number")
    .refine(
      (n) => Number(n) >= 1 && Number(n) <= max,
      `Enter a number from 1 to ${max.toLocaleString("en-IN")}`,
    );

/** Changes what one kitchen may use. Lowering a limit below what it holds deletes nothing. */
function LimitsDialog({
  row,
  maxima,
  external,
  onClose,
  onDone,
}: {
  row: Row;
  maxima: Limits;
  external: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const maxMb = Math.floor(maxima.bytes / MB);
  const form = useAppForm(
    z.object({
      people: limit(maxima.people),
      rows: limit(maxima.rows),
      requestsPerDay: limit(maxima.requestsPerDay),
      storage: limit(maxMb),
    }),
    {
      people: String(row.limits.people),
      rows: String(row.limits.rows),
      requestsPerDay: String(row.limits.requestsPerDay),
      storage: String(Math.round(row.limits.bytes / MB)),
    },
  );
  const field = (
    name: "people" | "rows" | "requestsPerDay" | "storage",
    label: string,
    max: number,
    fixed: boolean,
  ) => (
    <FormField
      name={name}
      label={label}
      required
      description={`Up to ${max.toLocaleString("en-IN")}`}
    >
      {(f) => <CountInput {...f} disabled={fixed} />}
    </FormField>
  );
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit limits: ${row.slug}`}
      description={
        <>
          Lowering a limit below what the kitchen already holds deletes nothing. The kitchen is
          shown as over its limit, and after the grace days can still read and take a copy of its
          data but not add to it.
          {external
            ? " This kitchen runs on its own database, so only its requests a day can be set."
            : ""}
        </>
      }
      formId="limits-form"
      submitLabel="Save"
      busyLabel="Saving…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
    >
      <AppForm
        id="limits-form"
        form={form}
        onSubmit={async (v) => {
          const body: Partial<Limits> = { requestsPerDay: Number(v.requestsPerDay) };
          if (!external) {
            body.people = Number(v.people);
            body.rows = Number(v.rows);
            body.bytes = Number(v.storage) * MB;
          }
          await postJson(`/api/platform/workspaces/${row.slug}/limits`, body);
          toast.success("Limits saved.");
          onDone();
          onClose();
        }}
      >
        {field("people", "People", maxima.people, external)}
        {field("rows", "Records", maxima.rows, external)}
        {field("requestsPerDay", "Requests a day", maxima.requestsPerDay, false)}
        {field("storage", "Storage (MB)", maxMb, external)}
      </AppForm>
    </FormDialog>
  );
}

const STATE: Record<
  string,
  { status: Parameters<typeof StatusBadge>[0]["status"]; label: string }
> = {
  ACTIVE: { status: "active", label: "Active" },
  MIGRATING: { status: "pending", label: "Migrating" },
  MOVED: { status: "projected", label: "Moved" },
  WIPING: { status: "overdue", label: "Wiping" },
};

const RETENTION = {
  none: { status: "confirmed", label: "None due" },
  due: { status: "pending", label: "Due" },
  offered: { status: "pending", label: "Offered" },
  overdue: { status: "overdue", label: "Overdue" },
} as const;

function KitchensTab({ data, onChange }: { data: Listing; onChange: () => void }) {
  const [editing, setEditing] = useState<Row | null>(null);
  const release = useRun();
  return (
    <>
      <ActionProblem error={release.error} />
      <DataTable
        data={data.workspaces}
        getRowId={(w) => w.id}
        caption="Kitchens"
        searchLabel="Search addresses"
        empty={
          <EmptyState
            title="No kitchens yet"
            description="Kitchens that are started here are listed with their limits."
          />
        }
        initialSort={{ id: "address" }}
        columns={[
          {
            id: "address",
            header: "Address",
            sort: (w) => w.slug,
            search: (w) => w.slug,
            cell: (w) => (
              <Link
                href={`/w/${w.slug}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {w.slug}
              </Link>
            ),
          },
          {
            id: "state",
            header: "State",
            sort: (w) => w.state,
            facet: { label: "State", value: (w) => STATE[w.state]?.label ?? w.state },
            cell: (w) => (
              <StatusBadge
                status={STATE[w.state]?.status ?? "projected"}
                label={STATE[w.state]?.label ?? w.state}
              />
            ),
          },
          { id: "where", header: "Where", sort: (w) => w.placement, cell: (w) => w.placement },
          {
            id: "requests",
            header: "Requests today",
            align: "end",
            sort: (w) => w.requestsToday,
            cell: (w) => `${w.requestsToday} / ${w.limits.requestsPerDay}`,
          },
          {
            id: "over",
            header: "Over since",
            sort: (w) => w.overSince,
            cell: (w) => w.overSince ?? "-",
          },
          {
            id: "older",
            header: "Older months",
            cell: (w) => (
              <span className="flex flex-col items-start gap-1">
                <StatusBadge
                  status={RETENTION[w.retention.state].status}
                  label={RETENTION[w.retention.state].label}
                />
                <span className="text-xs text-muted-foreground">
                  {w.retention.retainedFrom ? `from ${w.retention.retainedFrom}, ` : ""}
                  {w.retention.liveRows} entries, {w.retention.cuts} handed over
                  {w.retention.restored ? ", restored: can be handed over again" : ""}
                </span>
              </span>
            ),
          },
        ]}
        mobile={{
          title: (w) => w.slug,
          description: (w) =>
            `${w.placement} · ${w.requestsToday} / ${w.limits.requestsPerDay} requests today`,
          trailing: (w) => (
            <StatusBadge
              status={STATE[w.state]?.status ?? "projected"}
              label={STATE[w.state]?.label ?? w.state}
            />
          ),
        }}
        rowLabel={(w) => w.slug}
        rowActions={(w) =>
          w.state === "ACTIVE" && !data.capacity.dedicated ? (
            <DropdownMenuItem onClick={() => setEditing(w)}>Edit limits</DropdownMenuItem>
          ) : w.state === "MIGRATING" ? (
            <DropdownMenuItem
              onClick={() =>
                void release.run(async () => {
                  await api.post(`/api/platform/workspaces/${w.slug}/release`);
                  toast.success("Released: writing is open again.");
                  onChange();
                })
              }
            >
              Release
            </DropdownMenuItem>
          ) : null
        }
      />
      {editing ? (
        <LimitsDialog
          key={editing.id}
          row={editing}
          maxima={data.capacity.maxima}
          external={editing.placement === "external"}
          onClose={() => setEditing(null)}
          onDone={onChange}
        />
      ) : null}
    </>
  );
}

/** `/app/operator`: for whoever runs the service: its kitchens and their limits, who has asked for a place, and its capacity. */
export function Operator() {
  const { me } = useSession();
  const list = useLoad<Listing>(me?.operator ? "/api/platform/workspaces" : null);
  const housekeeping = useRun();
  const [tab, setTab] = useUrlState("tab", "kitchens");
  return (
    <OutsideLayout>
      <SignedIn>
        {me && !me.operator ? (
          <NotAvailable
            title="This is for the operator"
            backTo="/app"
            backLabel="Go to your kitchens"
          >
            Only whoever runs this service can open this page.
          </NotAvailable>
        ) : (
          <>
            <PageHeader
              title="Operator"
              description="The kitchens on this service, who has asked for a place, and how much room is left."
              actions={
                <Button
                  variant="outline"
                  loading={housekeeping.busy}
                  loadingText="Running…"
                  onClick={() =>
                    void housekeeping.run(async () => {
                      const r = await postJson<Record<string, unknown>>(
                        "/api/platform/housekeeping",
                      );
                      toast.success(`Housekeeping done: ${JSON.stringify(r).slice(0, 120)}`);
                      list.reload();
                    })
                  }
                >
                  Run housekeeping
                </Button>
              }
            />
            <div className="flex flex-col gap-4">
              <LoadProblem error={list.error} onRetry={list.reload} />
              <ActionProblem error={housekeeping.error} />
              <PageSkeleton loading={list.loading} variant="table">
                {list.data ? (
                  <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                    <TabsList
                      variant="line"
                      aria-label="Operator"
                      className="w-full justify-start sm:w-fit"
                    >
                      <TabsTrigger value="kitchens" className="flex-none px-4">
                        Kitchens
                      </TabsTrigger>
                      <TabsTrigger value="people" className="flex-none px-4">
                        People
                      </TabsTrigger>
                      <TabsTrigger value="settings" className="flex-none px-4">
                        Settings
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="kitchens" className="flex flex-col gap-4 pt-4">
                      <KitchensTab data={list.data} onChange={list.reload} />
                    </TabsContent>
                    <TabsContent value="people" className="pt-4">
                      <Signups mode={list.data.capacity.signup} onChange={list.reload} />
                    </TabsContent>
                    <TabsContent value="settings" className="pt-4">
                      <CapacityFigures c={list.data.capacity} />
                    </TabsContent>
                  </Tabs>
                ) : null}
              </PageSkeleton>
            </div>
          </>
        )}
      </SignedIn>
    </OutsideLayout>
  );
}
