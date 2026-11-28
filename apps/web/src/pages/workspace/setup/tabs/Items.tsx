import type { CatalogueItemDto, ItemKind, Service } from "@alimentation/core";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { api, getJson, postJson } from "@/api";
import {
  CountInput,
  type DataColumn,
  DataTable,
  EmptyState,
  FormField,
  StatusBadge,
  toast,
  useAppForm,
} from "@/components/app";
import { SOLID_DESTRUCTIVE } from "@/components/app/styles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { inOrder, retiredBy, standing } from "../../../../catalogue.ts";
import { date, money } from "../../../../format.ts";
import { useWorkspace } from "../../context.tsx";
import {
  ABOUT_NAME,
  aboutName,
  CheckRow,
  FormModal,
  GroupField,
  LoadError,
  Section,
} from "../parts.tsx";
import { useLoad } from "../use-load.ts";

type Target = { what: "service"; row: Service } | { what: "item"; row: CatalogueItemDto };

const pathOf = (t: Target) => (t.what === "service" ? "services" : "catalogue");
const NAME_FIELD = { [ABOUT_NAME]: "name" } as const;

/** What a row's badge says, in words and not in colour alone. */
function Standing({ row, today }: { row: { archivedOn: string | null }; today: string }) {
  const s = standing({ archivedOn: row.archivedOn }, today);
  if (s.state === "inUse") return <StatusBadge status="active" label="In use" />;
  if (s.state === "retiring")
    return <StatusBadge status="pending" label={`Retires ${date(s.on)}`} />;
  return <StatusBadge status="disabled" label={`Retired ${date(s.on)}`} />;
}

const nameRule = (max: number) =>
  z.string().trim().min(1, "Enter a name").max(max, `Use ${max} characters or fewer`);

/** A new service, such as lunch or dinner. */
function AddService({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const form = useAppForm(z.object({ name: nameRule(40) }), { name: "" });
  return (
    <FormModal
      form={form}
      title="Add a service"
      description="A service is a time of day you serve, such as Breakfast, Lunch or Dinner. Everyone already in the kitchen takes it from the first of this month. You can change who takes what under People."
      submitLabel="Add service"
      busyLabel="Adding…"
      onClose={onClose}
      serverFields={NAME_FIELD}
      onSubmit={async ({ name }) => {
        try {
          await postJson(`${ws.api}/services`, { name });
        } catch (e) {
          throw aboutName(e);
        }
        toast.success(`${name} added.`);
        onDone();
      }}
    >
      <FormField name="name" label="Name" description="For example Breakfast, Lunch or Dinner.">
        {(f) => <Input {...f} maxLength={40} autoComplete="off" />}
      </FormField>
    </FormModal>
  );
}

const itemSchema = z
  .object({
    kind: z.enum(["meal", "addon"]),
    name: nameRule(60),
    unit: z
      .string()
      .trim()
      .min(1, "Enter what it is counted in, such as plate")
      .max(20, "Use 20 characters or fewer"),
    maxQty: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "addon") return;
    const n = Number(v.maxQty);
    if (!/^\d+$/.test(v.maxQty) || n < 1 || n > 99)
      ctx.addIssue({
        code: "custom",
        path: ["maxQty"],
        message: "Enter a whole number from 1 to 99",
      });
  });

const KINDS: { value: ItemKind; title: string; hint: string; unit: string }[] = [
  { value: "meal", title: "Meal", hint: "Served each day", unit: "plate" },
  { value: "addon", title: "Add-on", hint: "Asked for as an extra", unit: "piece" },
];

/** A new meal or add-on. Its kind, unit and largest quantity are fixed once it is made. */
function AddItem({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const form = useAppForm(itemSchema, { kind: "meal", name: "", unit: "plate", maxQty: "20" });
  const kind = form.watch("kind");
  return (
    <FormModal
      form={form}
      title="Add an item"
      description="Its kind, counted-in unit and largest quantity cannot be changed later. Its name can. New food means a new item."
      submitLabel="Add item"
      busyLabel="Adding…"
      onClose={onClose}
      serverFields={NAME_FIELD}
      onSubmit={async (v) => {
        try {
          await postJson(`${ws.api}/catalogue`, {
            kind: v.kind,
            name: v.name,
            unit: v.unit,
            maxQty: v.kind === "addon" ? Number(v.maxQty) : 20,
          });
        } catch (e) {
          throw aboutName(e);
        }
        toast.success(`${v.name} added.`);
        onDone();
      }}
    >
      <GroupField label="Kind">
        {(labelId) => (
          <RadioGroup
            aria-labelledby={labelId}
            value={kind}
            onValueChange={(v) => {
              const next = v as ItemKind;
              const was = KINDS.find((k) => k.value === kind);
              form.setValue("kind", next);
              // A unit nobody has changed follows the kind: plates for a meal, pieces for an add-on.
              if (form.getValues("unit") === was?.unit)
                form.setValue("unit", KINDS.find((k) => k.value === next)?.unit ?? "plate");
            }}
          >
            {KINDS.map((k) => (
              <CheckKind key={k.value} value={k.value} title={k.title} hint={k.hint} />
            ))}
          </RadioGroup>
        )}
      </GroupField>
      <FormField name="name" label="Name">
        {(f) => <Input {...f} maxLength={60} autoComplete="off" />}
      </FormField>
      <FormField name="unit" label="Counted in" description="For example plate, piece or cup.">
        {(f) => <Input {...f} maxLength={20} autoComplete="off" />}
      </FormField>
      {kind === "addon" ? (
        <FormField name="maxQty" label="Most in one entry" description="From 1 to 99.">
          {(f) => <CountInput {...f} maxLength={2} />}
        </FormField>
      ) : null}
    </FormModal>
  );
}

/** One radio choice drawn as a row you can press anywhere on. */
function CheckKind({ value, title, hint }: { value: string; title: string; hint: string }) {
  const id = `kind-${value}`;
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-2.5 has-data-checked:border-primary/40 has-data-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
    >
      <RadioGroupItem id={id} value={value} />
      <FieldContent>
        <FieldTitle>{title}</FieldTitle>
        <FieldDescription>{hint}</FieldDescription>
      </FieldContent>
    </label>
  );
}

function Rename({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const form = useAppForm(z.object({ name: nameRule(target.what === "service" ? 40 : 60) }), {
    name: target.row.name,
  });
  return (
    <FormModal
      form={form}
      title={`Rename ${target.row.name}`}
      description="The new name shows everywhere, in past months too. Bills do not change: they follow the item, not its name."
      submitLabel="Rename"
      busyLabel="Renaming…"
      onClose={onClose}
      serverFields={NAME_FIELD}
      onSubmit={async ({ name }) => {
        try {
          await api.patch(`${ws.api}/${pathOf(target)}/${target.row.id}`, { name });
        } catch (e) {
          throw aboutName(e);
        }
        toast.success(`Renamed to ${name}.`);
        onDone();
      }}
    >
      <FormField name="name" label="Name">
        {(f) => <Input {...f} maxLength={target.what === "service" ? 40 : 60} autoComplete="off" />}
      </FormField>
    </FormModal>
  );
}

/**
 * Retiring is permanent, so it is the ladder's middle rung and asks (FRM-01): the title names the thing, a box is
 * ticked to say the name stays taken, the destructive button is red and on the right, and "Keep it" has the focus.
 */
function Retire({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const name = target.row.name;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent initialFocus={keep}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-background text-destructive ring-1 ring-destructive/40">
            <TriangleAlertIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Retire {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops being offered from today. Past months, bills and history keep it. This cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <CheckRow checked={ack} onChange={setAck} title="I understand this name stays taken" />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={keep} disabled={busy}>
            Keep it
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={SOLID_DESTRUCTIVE}
            disabled={!ack}
            loading={busy}
            loadingText="Retiring…"
            onClick={async (e) => {
              // Stay open until the server has answered, so a refusal can be read here.
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.patch(`${ws.api}/${pathOf(target)}/${target.row.id}`, { archived: true });
                toast.success(`${name} retired.`);
                onDone();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "That did not work. Try again.");
                setBusy(false);
              }
            }}
          >
            Retire {name}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * What the kitchen serves: its services and its items. Items are meals and add-ons; both can be renamed and
 * retired, and neither is ever deleted, so a past bill can always name what it was for.
 */
export function ItemsTab() {
  const ws = useWorkspace();
  const { boot } = ws;
  const items = useLoad(() => getJson<CatalogueItemDto[]>(`${ws.api}/catalogue`), ws.api);
  const [adding, setAdding] = useState<"service" | "item" | null>(null);
  const [rename, setRename] = useState<Target | null>(null);
  const [retire, setRetire] = useState<Target | null>(null);
  const all = items.data ?? (boot.catalogue as CatalogueItemDto[]);
  const services = inOrder(boot.services);
  const liveServices = services.filter((s) => !retiredBy(s, boot.today));
  const done = () => {
    items.reload();
    ws.reload();
  };

  const priceOf = (i: CatalogueItemDto) => {
    if (!ws.money) return null;
    const base = i.prices?.find((p) => p.serviceId === null);
    return base ? money(base.amount) : i.prices ? "Not priced" : null;
  };
  const kindWord = (i: CatalogueItemDto) => (i.kind === "meal" ? "Meal" : "Add-on");

  const itemColumns: DataColumn<CatalogueItemDto>[] = [
    {
      id: "name",
      header: "Name",
      cell: (i) => i.name,
      sort: (i) => i.name,
      search: (i) => i.name,
    },
    {
      id: "kind",
      header: "Type",
      cell: kindWord,
      sort: kindWord,
      facet: { label: "Type", value: kindWord },
    },
    { id: "unit", header: "Counted in", cell: (i) => i.unit, search: (i) => i.unit },
    {
      id: "max",
      header: "Most in one entry",
      align: "end",
      cell: (i) => (i.kind === "addon" ? i.maxQty : ""),
      sort: (i) => (i.kind === "addon" ? i.maxQty : null),
    },
    ...(ws.money
      ? [
          {
            id: "price",
            header: "Price",
            align: "end" as const,
            cell: (i: CatalogueItemDto) => priceOf(i) ?? "",
          },
        ]
      : []),
    { id: "status", header: "Status", cell: (i) => <Standing row={i} today={boot.today} /> },
  ];

  const serviceColumns: DataColumn<Service>[] = [
    { id: "name", header: "Name", cell: (s) => s.name, sort: (s) => s.name },
    { id: "status", header: "Status", cell: (s) => <Standing row={s} today={boot.today} /> },
  ];

  const actions = (target: (row: never) => Target, canRetire: (row: never) => boolean) =>
    ((row: never) => (
      <>
        <DropdownMenuItem disabled={!ws.writable} onClick={() => setRename(target(row))}>
          Rename
        </DropdownMenuItem>
        {canRetire(row) ? (
          <DropdownMenuItem
            variant="destructive"
            disabled={!ws.writable}
            onClick={() => setRetire(target(row))}
          >
            Retire…
          </DropdownMenuItem>
        ) : null}
      </>
    )) as never;

  return (
    <div className="flex flex-col gap-8">
      <LoadError error={items.error} onRetry={items.reload} />
      <Section
        title="Meals and add-ons"
        description="What the kitchen serves. The menu puts meals on days; prices come after."
        actions={
          <Button type="button" disabled={!ws.writable} onClick={() => setAdding("item")}>
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            Add an item
          </Button>
        }
      >
        <DataTable
          data={all}
          columns={itemColumns}
          getRowId={(i) => i.id}
          caption="Meals and add-ons"
          searchLabel="Search items"
          rowLabel={(i) => i.name}
          rowActions={actions(
            (i: CatalogueItemDto) => ({ what: "item", row: i }),
            (i: CatalogueItemDto) => i.archivedOn === null,
          )}
          mobile={{
            title: (i) => i.name,
            description: (i) =>
              [kindWord(i), i.unit, priceOf(i)].filter((x) => x !== null && x !== "").join(" · "),
            trailing: (i) => <Standing row={i} today={boot.today} />,
          }}
          empty={
            <EmptyState
              title="Nothing to serve yet"
              description="Add what you serve, such as a thali or a roti. The menu puts it on days."
              action={
                <Button type="button" disabled={!ws.writable} onClick={() => setAdding("item")}>
                  Add an item
                </Button>
              }
            />
          }
        />
      </Section>

      <Section
        title={liveServices.length > 1 ? "Services" : "Service"}
        description="The times of day the kitchen serves."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={!ws.writable}
            onClick={() => setAdding("service")}
          >
            Add a service
          </Button>
        }
      >
        <DataTable
          data={services}
          columns={serviceColumns}
          getRowId={(s) => s.id}
          caption="Services"
          searchable={false}
          rowLabel={(s) => s.name}
          rowActions={actions(
            (s: Service) => ({ what: "service", row: s }),
            (s: Service) => s.archivedOn === null && liveServices.length > 1,
          )}
          mobile={{
            title: (s) => s.name,
            trailing: (s) => <Standing row={s} today={boot.today} />,
          }}
          empty={
            <EmptyState
              title="No service yet"
              description="A service is a time of day you serve, such as Lunch. Add one, then the meals."
              action={
                <Button type="button" disabled={!ws.writable} onClick={() => setAdding("service")}>
                  Add a service
                </Button>
              }
            />
          }
        />
      </Section>

      {adding === "service" ? <AddService onClose={() => setAdding(null)} onDone={done} /> : null}
      {adding === "item" ? <AddItem onClose={() => setAdding(null)} onDone={done} /> : null}
      {rename ? (
        <Rename key={rename.row.id} target={rename} onClose={() => setRename(null)} onDone={done} />
      ) : null}
      {retire ? (
        <Retire key={retire.row.id} target={retire} onClose={() => setRetire(null)} onDone={done} />
      ) : null}
    </div>
  );
}
