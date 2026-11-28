import type { OrganisationDto, OrganisationKitchenDto } from "@alimentation/core";
import { must } from "@alimentation/core";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { z } from "zod";
import { ApiFailure, api, postJson } from "@/api";
import {
  AppForm,
  ConfirmAction,
  DataTable,
  EmptyState,
  FormField,
  Money,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlState } from "@/hooks";
import { month as monthLabel, plural } from "../format.ts";
import { sumOrganisation } from "../kitchens.ts";
import { useSession } from "../session.tsx";
import { OutsideLayout, SignedIn } from "./outside/Layout.tsx";
import { CopyField, LoadProblem, useLoad } from "./outside/parts.tsx";
import { StatCard } from "./workspace/bills/StatCard.tsx";
import { ActionProblem, useRun } from "./workspace/books/parts.tsx";

const WHY: Record<NonNullable<OrganisationKitchenDto["unavailable"]>, string> = {
  moved: "Has moved",
  busy: "Has used its requests for today",
  unreadable: "Could not be read just now",
};

/** The kitchens' figures added up: what the head office sees first. */
function Totals({ kitchens }: { kitchens: OrganisationKitchenDto[] }) {
  const sum = sumOrganisation(kitchens);
  if (!sum)
    return (
      <EmptyState
        title={kitchens.length === 0 ? "No kitchen shares its totals yet" : "No figures to add up"}
        description={
          kitchens.length === 0
            ? "Add one of your kitchens, or send a link to the admin of another."
            : "The kitchens cannot be read just now."
        }
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sum.money ? (
          <>
            <StatCard label="Billed">
              <Money paise={sum.money.billed} />
            </StatCard>
            <StatCard label="Paid">
              <Money paise={sum.money.paid} />
            </StatCard>
            <StatCard label="Owed">
              <Money paise={sum.money.owed} />
            </StatCard>
            <StatCard label="To confirm">{sum.money.toConfirm || "-"}</StatCard>
          </>
        ) : null}
        <StatCard label="People fed">{sum.consumers}</StatCard>
        <StatCard label="Meals">{sum.meals}</StatCard>
        <StatCard label="Not set up">{sum.setup || "-"}</StatCard>
      </div>
      {sum.mealsOnly > 0 ? (
        <p className="text-sm text-muted-foreground">
          {sum.mealsOnly} kitchen{sum.mealsOnly === 1 ? " does" : "s do"} not track money, so{" "}
          {sum.mealsOnly === 1 ? "it is" : "they are"} in the counts and not in the money.
        </p>
      ) : null}
      {sum.unread === 0 && !sum.money && sum.counted > sum.mealsOnly ? (
        <p className="text-sm text-muted-foreground">
          The money is left out because the kitchens that track it keep their books in different
          currencies.
        </p>
      ) : null}
      {sum.unread > 0 ? (
        <p className="text-sm text-muted-foreground">
          {sum.unread} kitchen{sum.unread === 1 ? "" : "s"} could not be read and{" "}
          {sum.unread === 1 ? "is" : "are"} not in these figures.
        </p>
      ) : null}
    </div>
  );
}

/** A kitchen's money figures, when it has any. */
const moneyOf = (k: OrganisationKitchenDto) => {
  const t = k.totals;
  return t?.moneyEnabled ? t : null;
};

function KitchensTable({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  const [removing, setRemoving] = useState<OrganisationKitchenDto | null>(null);
  // Columns of money are there when at least one kitchen can fill them.
  const anyMoney = data.kitchens.some((k) => k.totals?.moneyEnabled !== false);
  const mine = new Set((me?.workspaces ?? []).map((w) => w.slug));
  const never = <span className="text-muted-foreground">-</span>;
  return (
    <>
      <DataTable
        data={data.kitchens}
        getRowId={(k) => k.slug}
        caption="Kitchens"
        searchable={false}
        empty={null}
        columns={[
          {
            id: "kitchen",
            header: "Kitchen",
            sort: (k) => k.name,
            cell: (k) => (
              <div className="flex flex-col gap-0.5">
                {mine.has(k.slug) ? (
                  <Link
                    href={`/w/${k.slug}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {k.name}
                  </Link>
                ) : (
                  <span className="font-medium">{k.name}</span>
                )}
                {k.totals ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {monthLabel(k.totals.month)}
                    {k.totals.setup > 0 ? (
                      <StatusBadge status="pending" label="Needs setting up" />
                    ) : null}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {k.unavailable ? WHY[k.unavailable] : ""}
                  </span>
                )}
              </div>
            ),
          },
          {
            id: "people",
            header: "People",
            align: "end",
            sort: (k) => k.totals?.consumers,
            cell: (k) => k.totals?.consumers ?? never,
          },
          {
            id: "meals",
            header: "Meals",
            align: "end",
            sort: (k) => k.totals?.meals,
            cell: (k) => k.totals?.meals ?? never,
          },
          ...(anyMoney
            ? [
                {
                  id: "billed",
                  header: "Billed",
                  align: "end" as const,
                  sort: (k: OrganisationKitchenDto) => moneyOf(k)?.billed,
                  cell: (k: OrganisationKitchenDto) =>
                    moneyOf(k) ? <Money paise={moneyOf(k)?.billed ?? 0} /> : never,
                },
                {
                  id: "paid",
                  header: "Paid",
                  align: "end" as const,
                  sort: (k: OrganisationKitchenDto) => moneyOf(k)?.paid,
                  cell: (k: OrganisationKitchenDto) =>
                    moneyOf(k) ? <Money paise={moneyOf(k)?.paid ?? 0} /> : never,
                },
                {
                  id: "owed",
                  header: "Owed",
                  align: "end" as const,
                  sort: (k: OrganisationKitchenDto) => moneyOf(k)?.owed,
                  cell: (k: OrganisationKitchenDto) =>
                    moneyOf(k) ? <Money paise={moneyOf(k)?.owed ?? 0} /> : never,
                },
                {
                  id: "toConfirm",
                  header: "To confirm",
                  align: "end" as const,
                  cell: (k: OrganisationKitchenDto) => moneyOf(k)?.toConfirm || never,
                },
              ]
            : []),
        ]}
        mobile={{
          title: (k) => k.name,
          description: (k) =>
            k.totals
              ? `${plural(k.totals.consumers, "person", "people")} · ${plural(k.totals.meals, "meal")}`
              : k.unavailable
                ? WHY[k.unavailable]
                : "",
          trailing: (k) => (moneyOf(k) ? <Money paise={moneyOf(k)?.owed ?? 0} /> : null),
        }}
        rowLabel={(k) => k.name}
        rowActions={(k) => (
          <DropdownMenuItem onClick={() => setRemoving(k)}>
            Remove from this organisation
          </DropdownMenuItem>
        )}
      />
      <ConfirmAction
        level="confirm"
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Stop ${removing?.name ?? "this kitchen"} sharing its totals?`}
        description="The kitchen is no longer in these figures. It can share again only with its own admin's agreement."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          await api.del(`/api/organisations/${data.organisation.id}/kitchens/${removing.slug}`);
          toast.success(`${removing.name} no longer shares its totals.`);
          onChange();
        }}
      />
    </>
  );
}

const addSchema = z.object({ slug: z.string().min(1, "Choose a kitchen") });

function AddMine({
  data,
  mine,
  onChange,
}: {
  data: OrganisationDto;
  mine: { slug: string; name: string }[];
  onChange: () => void;
}) {
  const form = useAppForm(addSchema, { slug: must(mine[0]).slug });
  return (
    <AppForm
      form={form}
      onSubmit={async (v) => {
        await postJson(`/api/organisations/${data.organisation.id}/kitchens`, { slug: v.slug });
        toast.success("Added.");
        onChange();
      }}
    >
      <FormField name="slug" label="A kitchen you run">
        {(f) => (
          <NativeSelect {...f} className="w-full sm:w-72">
            {mine.map((w) => (
              <NativeSelectOption key={w.slug} value={w.slug}>
                {w.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <SubmitButton busy="Adding…" className="self-start">
        Add it
      </SubmitButton>
    </AppForm>
  );
}

function AddKitchen({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  const make = useRun();
  const [link, setLink] = useState<string | null>(null);
  const already = new Set(data.kitchens.map((k) => k.slug));
  const mine = (me?.workspaces ?? []).filter(
    (w) => w.state === "ACTIVE" && w.roles.includes("admin") && !already.has(w.slug),
  );
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Add a kitchen</h2>
        <CardDescription>
          A kitchen joins only when its own admin agrees, and can stop whenever it likes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {mine.length > 0 ? (
          <AddMine
            key={mine.map((w) => w.slug).join(",")}
            data={data}
            mine={mine}
            onChange={onChange}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            There is no other kitchen of yours to add.
          </p>
        )}
        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm">
            <strong>A kitchen someone else runs.</strong> Make a link and send it to its admin. They
            paste it under <em>Your data</em> in that kitchen, see that it is for{" "}
            {data.organisation.name}, and choose to share. It works for seven days.
          </p>
          <div>
            <Button
              variant="outline"
              type="button"
              loading={make.busy}
              loadingText="Making a link…"
              onClick={() =>
                void make.run(async () => {
                  const r = await postJson<{ token: string }>(
                    `/api/organisations/${data.organisation.id}/join-links`,
                  );
                  setLink(r.token);
                })
              }
            >
              Make a link
            </Button>
          </div>
          <ActionProblem error={make.error} />
          {link ? <CopyField label="The link" value={link} copyLabel="Copy the link" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

const memberSchema = z.object({
  email: z.string().trim().min(1, "Enter their email").email("That does not look like an email"),
});

function People({ data, onChange }: { data: OrganisationDto; onChange: () => void }) {
  const { me } = useSession();
  const form = useAppForm(memberSchema, { email: "" });
  const [leaving, setLeaving] = useState<string | null>(null);
  const leave = data.members.find((m) => m.accountId === leaving);
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        These people see the totals. They see no names, and they are not members of any kitchen
        because of this.
      </p>
      <ItemGroup className="gap-2">
        {data.members.map((m) => (
          <Item key={m.accountId} variant="outline" role="listitem">
            <ItemContent>
              <ItemTitle>{m.name ?? m.email}</ItemTitle>
              {m.name ? <ItemDescription>{m.email}</ItemDescription> : null}
            </ItemContent>
            {data.members.length > 1 ? (
              <ItemActions>
                <Button variant="outline" size="sm" onClick={() => setLeaving(m.accountId)}>
                  {m.accountId === me?.account?.id ? "Leave" : "Remove"}
                  <span className="sr-only"> {m.name ?? m.email}</span>
                </Button>
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </ItemGroup>
      <ConfirmAction
        level="confirm"
        open={leave !== undefined}
        onOpenChange={(o) => !o && setLeaving(null)}
        title={
          leave?.accountId === me?.account?.id
            ? "Leave this head office?"
            : `Remove ${leave?.name ?? leave?.email ?? "this person"}?`
        }
        description="They no longer see these totals."
        confirmLabel={leave?.accountId === me?.account?.id ? "Leave" : "Remove"}
        onConfirm={async () => {
          if (!leave) return;
          await api.del(`/api/organisations/${data.organisation.id}/members/${leave.accountId}`);
          onChange();
        }}
      />
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Add someone</h2>
          <CardDescription>They must have signed in here once.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppForm
            form={form}
            serverFields={{ not_found: "email" }}
            onSubmit={async (v) => {
              await postJson(`/api/organisations/${data.organisation.id}/members`, {
                email: v.email,
              });
              form.reset();
              toast.success("Added to the head office.");
              onChange();
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
            <SubmitButton busy="Adding…" className="self-start">
              Add
            </SubmitButton>
          </AppForm>
        </CardContent>
      </Card>
    </div>
  );
}

/** `/app/org/:id`: a head office over its kitchens, added up, with the people who see it. */
export function Organisation() {
  const { id = "" } = useParams();
  const org = useLoad<OrganisationDto>(`/api/organisations/${id}`);
  const [tab, setTab] = useUrlState("tab", "kitchens");
  const notFound = org.error instanceof ApiFailure && org.error.status === 404 && !org.data;
  return (
    <OutsideLayout>
      <SignedIn>
        {notFound ? (
          <NotAvailable
            title="Organisation not found"
            backTo="/app"
            backLabel="Go to your kitchens"
          >
            There is no such organisation, or you are not in its head office.
          </NotAvailable>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-2"
              nativeButton={false}
              render={<Link href="/app" />}
            >
              <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
              Your kitchens
            </Button>
            <PageHeader
              title={org.data?.organisation.name ?? "Organisation"}
              description="Each kitchen's totals for its month: how many people, how many meals, what was billed, paid and is owed. Nothing here names anyone."
            />
            <div className="flex flex-col gap-4">
              {org.error ? <LoadProblem error={org.error} onRetry={org.reload} /> : null}
              <PageSkeleton loading={org.loading} variant="table">
                {org.data ? (
                  <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                    <TabsList
                      variant="line"
                      aria-label="Organisation"
                      className="w-full justify-start sm:w-fit"
                    >
                      <TabsTrigger value="kitchens" className="flex-none px-4">
                        Kitchens
                      </TabsTrigger>
                      <TabsTrigger value="people" className="flex-none px-4">
                        People
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="kitchens" className="flex flex-col gap-6 pt-4">
                      <Totals kitchens={org.data.kitchens} />
                      {org.data.kitchens.length > 0 ? (
                        <KitchensTable data={org.data} onChange={org.reload} />
                      ) : null}
                      <AddKitchen data={org.data} onChange={org.reload} />
                    </TabsContent>
                    <TabsContent value="people" className="pt-4">
                      <People data={org.data} onChange={org.reload} />
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
