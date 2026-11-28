import { CheckIcon, CopyIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { api, getJson, postJson } from "@/api";
import {
  AppForm,
  ConfirmAction,
  CountInput,
  type DataColumn,
  DataTable,
  EmptyState,
  FormDialog,
  FormField,
  StatusBadge,
  toast,
  useAppForm,
} from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { date } from "@/format";
import { useWorkspace } from "../context.tsx";
import { LoadProblem, Section, useLoad } from "./parts.tsx";

interface Key {
  id: string;
  name: string;
  role: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  mine: boolean;
  ownerEmail?: string;
}

const SCOPES = [
  ["log", "May add and withdraw entries (leaves, extras, days off)."],
  ["claims", "May say that a payment was made."],
] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Name the key, so you know which to end later").max(80),
  scopes: z.array(z.string()),
  days: z
    .string()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365, "Enter 1 to 365 days"),
});

const isEnded = (k: Key) => k.revokedAt !== null || new Date(k.expiresAt) < new Date();

/** The key, shown once, with a button that copies it. */
function FreshKey({ made, onDone }: { made: { name: string; token: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert role="status">
      <AlertDescription className="flex flex-col gap-3">
        <p>
          <strong>{made.name}</strong>: copy this key now. It will not be shown again.
        </p>
        <div className="flex items-center gap-2">
          <Input
            aria-label="The key"
            readOnly
            value={made.token}
            className="font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void navigator.clipboard?.writeText(made.token).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied" : "Copy the key"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Its address for software that speaks MCP is <code>{location.origin}/mcp</code>, with the
          key as a bearer token.
        </p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            I have copied it
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function NewKey({
  open,
  onOpenChange,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMade: (made: { name: string; token: string }) => void;
}) {
  const ws = useWorkspace();
  const form = useAppForm(schema, { name: "", scopes: [] as string[], days: "90" });
  const scopes = form.watch("scopes");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New key"
      description="A key lets software act for you here: as you, in the role you are using, and no further."
      formId="agent-key-form"
      submitLabel="Make a key"
      busyLabel="Making…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
    >
      <AppForm
        id="agent-key-form"
        form={form}
        onSubmit={async (v) => {
          const made = await postJson<{ name: string; token: string }>(`${ws.api}/agents`, {
            name: v.name,
            scopes: v.scopes,
            days: Number(v.days),
          });
          form.reset();
          onOpenChange(false);
          onMade({ name: made.name, token: made.token });
        }}
      >
        <FormField
          name="name"
          label="Name for the key"
          description="What it is for, so you know which to end later."
          required
        >
          {(f) => <Input {...f} maxLength={80} autoComplete="off" />}
        </FormField>
        <FieldSet>
          <FieldLegend variant="label">What it may do besides reading</FieldLegend>
          {SCOPES.filter(([key]) => ws.money || key !== "claims").map(([key, label]) => (
            <Field key={key} orientation="horizontal">
              <Checkbox
                id={`scope-${key}`}
                checked={scopes.includes(key)}
                onCheckedChange={(on) =>
                  form.setValue("scopes", on ? [...scopes, key] : scopes.filter((s) => s !== key), {
                    shouldDirty: true,
                  })
                }
              />
              <FieldLabel htmlFor={`scope-${key}`} className="font-normal">
                {label}
              </FieldLabel>
            </Field>
          ))}
          <FieldDescription>With neither ticked, the key can only read.</FieldDescription>
        </FieldSet>
        <FormField name="days" label="Days it lasts" description="Up to 365." required>
          {(f) => <CountInput {...f} className="max-w-32" />}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}

/**
 * Keys for AI agents: what they are, who has them, and a way to make one and to end one. A key's token is shown
 * once, when it is made, and is not kept here.
 */
export function AgentKeys() {
  const ws = useWorkspace();
  const list = useLoad(() => getJson<{ keys: Key[] }>(`${ws.api}/agents`), [ws.api]);
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [ending, setEnding] = useState<Key | null>(null);
  const keys = list.data?.keys ?? [];

  const columns: DataColumn<Key>[] = [
    {
      id: "name",
      header: "Name",
      cell: (k) => <span className="font-medium">{k.name}</span>,
      sort: (k) => k.name,
      search: (k) => k.name,
    },
    {
      id: "for",
      header: "For",
      cell: (k) => `${k.mine ? "You" : (k.ownerEmail ?? "Someone")}, as ${k.role}`,
    },
    { id: "may", header: "May", cell: (k) => k.scopes.join(", ") },
    {
      id: "used",
      header: "Last used",
      cell: (k) => (k.lastUsedAt ? date(k.lastUsedAt.slice(0, 10)) : "Never"),
      sort: (k) => k.lastUsedAt ?? "",
    },
    {
      id: "ends",
      header: "Ends",
      cell: (k) =>
        isEnded(k) ? (
          <StatusBadge status="disabled" label={k.revokedAt ? "Ended" : "Expired"} />
        ) : (
          date(k.expiresAt.slice(0, 10))
        ),
      sort: (k) => k.expiresAt,
    },
  ];

  return (
    <Section
      title="AI agents"
      description={
        <>
          A key lets software act for a person here: as them, in the role you are using, and no
          further. It can read; if you allow it, it can add entries
          {ws.money ? " or say a payment was made" : ""}.{" "}
          {ws.money ? "Confirming payments, closing" : "Closing"} months and everything about
          people, {ws.money ? "prices and " : ""}the menu and the kitchen itself stay with a person.
          What it does is marked in the kitchen&apos;s history as an agent&apos;s, for everyone it
          affects to read. The key is shown once.
        </>
      }
    >
      <LoadProblem error={list.error} onRetry={list.reload} />
      {fresh ? <FreshKey made={fresh} onDone={() => setFresh(null)} /> : null}
      <div>
        <Button type="button" disabled={!ws.writable} onClick={() => setMaking(true)}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          New key
        </Button>
      </div>
      <DataTable<Key>
        data={keys}
        columns={columns}
        getRowId={(k) => k.id}
        caption="Keys for AI agents"
        searchLabel="Search keys"
        searchable={keys.length > 8}
        loading={list.loading && !list.data}
        rowLabel={(k) => k.name}
        rowActions={(k) =>
          isEnded(k) ? (
            <DropdownMenuItem disabled>Already ended</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => setEnding(k)}>
              End it
            </DropdownMenuItem>
          )
        }
        empty={
          <EmptyState
            title="No keys yet"
            description="Make a key when you want software to act for you here."
          />
        }
        mobile={{
          title: (k) => k.name,
          description: (k) =>
            `${k.mine ? "You" : (k.ownerEmail ?? "Someone")}, as ${k.role} · ${k.scopes.join(", ")}`,
          trailing: (k) =>
            isEnded(k) ? (
              <StatusBadge status="disabled" label={k.revokedAt ? "Ended" : "Expired"} />
            ) : (
              `Ends ${date(k.expiresAt.slice(0, 10))}`
            ),
        }}
      />
      <NewKey
        open={making}
        onOpenChange={setMaking}
        onMade={(made) => {
          setFresh(made);
          list.reload();
        }}
      />
      <ConfirmAction
        level="confirm"
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title={`End ${ending?.name ?? "this key"}?`}
        description="The software that holds it stops working at once. A key that has ended cannot be used again; make a new one if it is needed."
        confirmLabel="End the key"
        onConfirm={async () => {
          if (!ending) return;
          await api.del(`${ws.api}/agents/${ending.id}`);
          toast.success(`${ending.name} no longer works.`);
          list.reload();
        }}
      />
    </Section>
  );
}
