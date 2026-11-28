import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ApiFailure } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { THEME_LABEL, THEMES, useTheme } from "@/theme";
import { ConfirmAction } from "../ConfirmAction";
import { CountInput } from "../CountInput";
import { type DataColumn, DataTable } from "../DataTable";
import { DateField } from "../DateField";
import { EmptyState } from "../EmptyState";
import { FormDialog } from "../FormDialog";
import { AppForm, FormField, SubmitButton, useAppForm } from "../form";
import { Money } from "../Money";
import { MoneyInput } from "../MoneyInput";
import { MonthPicker } from "../MonthPicker";
import { NotAvailable } from "../NotAvailable";
import { PageHeader } from "../PageHeader";
import { type Status, StatusBadge } from "../StatusBadge";
import { FormSkeleton, ListSkeleton, StatsSkeleton, TableSkeleton } from "../skeletons";
import { SOLID_DESTRUCTIVE } from "../styles";
import { toast } from "../toast";

const STATUSES: Status[] = [
  "paid",
  "owed",
  "overdue",
  "pending",
  "confirmed",
  "disputed",
  "projected",
  "active",
  "invited",
  "disabled",
];

interface Row {
  id: string;
  name: string;
  plan: string;
  owed: number;
  status: Status;
}
const NAMES = ["Jovial", "Meadow", "Tulsi", "Birch", "Saffron", "Quill", "Harbor", "Willow"];
const ROWS: Row[] = Array.from({ length: 64 }, (_, i) => ({
  id: `r${i}`,
  name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
  plan: ["Lunch", "Dinner", "Both"][i % 3] ?? "Lunch",
  owed: i % 5 === 0 ? 0 : i % 7 === 0 ? -58000 : (i * 3715) % 400000,
  status: STATUSES[i % STATUSES.length] ?? "paid",
}));

const COLUMNS: DataColumn<Row>[] = [
  {
    id: "name",
    header: "Name",
    cell: (r) => <span className="font-medium">{r.name}</span>,
    sort: (r) => r.name,
    search: (r) => r.name,
  },
  {
    id: "plan",
    header: "Plan",
    cell: (r) => r.plan,
    sort: (r) => r.plan,
    facet: { label: "Plans", value: (r) => r.plan },
  },
  {
    id: "owed",
    header: "Balance",
    align: "end",
    cell: (r) => <Money paise={r.owed} credit fraction />,
    sort: (r) => r.owed,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
];

const formSchema = z.object({
  name: z.string().min(1, "Enter a name"),
  amount: z
    .string()
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter an amount like 3200 or 12.50"),
  meals: z.string().min(1, "Enter how many"),
  from: z.string().min(1, "Choose a date"),
  note: z.string().max(40, "Keep it under 40 characters"),
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`k-${title}`} className="flex flex-col gap-3 border-t pt-6">
      <h2 id={`k-${title}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function KitForm() {
  const form = useAppForm(formSchema, { name: "", amount: "", meals: "", from: "", note: "" });
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <AppForm
      form={form}
      serverFields={{ name_taken: "name" }}
      onSubmit={async (v) => {
        if (v.name.toLowerCase() === "taken")
          throw new ApiFailure(409, "name_taken", "That name is already used here.");
        setSaved(`Saved ${v.name}`);
      }}
      className="max-w-lg"
    >
      <FormField name="name" label="Name" required>
        {(f) => <Input {...f} autoComplete="off" />}
      </FormField>
      <FormField name="amount" label="Monthly fee" description="In rupees." required>
        {(f) => <MoneyInput {...f} />}
      </FormField>
      <FormField name="meals" label="Meals a day" required>
        {(f) => <CountInput {...f} />}
      </FormField>
      <FormField name="from" label="Starts on" required>
        {(f) => (
          <DateField
            id={f.id}
            aria-invalid={f["aria-invalid"]}
            aria-describedby={f["aria-describedby"]}
            value={f.value}
            onChange={f.onChange}
            onBlur={f.onBlur}
          />
        )}
      </FormField>
      <FormField name="note" label="Note">
        {(f) => <Input {...f} />}
      </FormField>
      <div className="flex items-center gap-3">
        <SubmitButton>Save person</SubmitButton>
        <Button type="button" variant="outline" onClick={() => form.reset()}>
          Reset
        </Button>
        {saved ? <p role="status">{saved}</p> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Type "taken" as the name to see a server refusal land on its field.
      </p>
    </AppForm>
  );
}

function KitDialog() {
  const [open, setOpen] = useState(false);
  const form = useAppForm(z.object({ title: z.string().min(1, "Enter a title") }), { title: "" });
  const dirty = form.formState.isDirty;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open form dialog</Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add a holiday"
        description="Meals are not served on a holiday."
        formId="kit-dialog-form"
        submitLabel="Add holiday"
        busyLabel="Adding…"
        submitting={form.formState.isSubmitting}
        dirty={dirty}
        onDiscard={() => form.reset()}
      >
        <AppForm
          id="kit-dialog-form"
          form={form}
          onSubmit={async () => {
            await new Promise((r) => setTimeout(r, 300));
            form.reset();
            setOpen(false);
            toast.success("Holiday added");
          }}
        >
          <FormField name="title" label="Title">
            {(f) => <Input {...f} />}
          </FormField>
          <div className="h-[60dvh]" aria-hidden="true" />
        </AppForm>
      </FormDialog>
    </>
  );
}

/**
 * Every app-kit component in each state, for the eye, the keyboard and axe: `/dev/kit` (development, or a build with
 * VITE_KIT=1). Light and dark come from the theme switch here, and the two viewports from the window.
 */
export function KitPage() {
  const [theme, setTheme] = useTheme();
  const [month, setMonth] = useState("2026-11");
  const [date, setDate] = useState("");
  const [money, setMoney] = useState("");
  const [count, setCount] = useState("");
  const [loadingTable, setLoadingTable] = useState(false);
  const [emptyTable, setEmptyTable] = useState(false);
  const [removed, setRemoved] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 md:p-6">
      <PageHeader
        title="App kit"
        description="Every shared component, in each state."
        actions={
          <div role="group" aria-label="Theme" className="flex gap-1">
            {THEMES.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={theme === t ? "default" : "outline"}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {THEME_LABEL[t]}
              </Button>
            ))}
          </div>
        }
      />

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Money">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <li>
            Zero: <Money paise={0} />
          </li>
          <li>
            Amount: <Money paise={334500} />
          </li>
          <li>
            Negative: <Money paise={-17000} />
          </li>
          <li>
            Credit: <Money paise={58000} credit />
          </li>
          <li>
            Column: <Money paise={15000} fraction /> <Money paise={15050} fraction />
          </li>
        </ul>
        <div className="grid max-w-lg gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="kit-money" className="text-sm font-medium">
              Amount
            </label>
            <MoneyInput id="kit-money" value={money} onChange={setMoney} />
          </div>
          <div>
            <label htmlFor="kit-money-bad" className="text-sm font-medium">
              Amount (error)
            </label>
            <MoneyInput
              id="kit-money-bad"
              value="12x"
              onChange={() => {}}
              aria-invalid
              aria-describedby="kit-money-bad-e"
            />
            <p id="kit-money-bad-e" className="text-sm text-destructive">
              Enter an amount like 3200 or 12.50
            </p>
          </div>
          <div>
            <label htmlFor="kit-money-off" className="text-sm font-medium">
              Amount (disabled)
            </label>
            <MoneyInput id="kit-money-off" value="3200" onChange={() => {}} disabled />
          </div>
          <div>
            <label htmlFor="kit-count" className="text-sm font-medium">
              Count
            </label>
            <CountInput id="kit-count" value={count} onChange={setCount} />
          </div>
        </div>
      </Section>

      <Section title="Dates">
        <div className="grid max-w-lg gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="kit-date" className="text-sm font-medium">
              Date
            </label>
            <DateField id="kit-date" value={date} onChange={setDate} label="Choose a date" />
          </div>
          <div>
            <label htmlFor="kit-date-off" className="text-sm font-medium">
              Date (disabled)
            </label>
            <DateField id="kit-date-off" value="2026-11-02" onChange={() => {}} disabled />
          </div>
        </div>
        <MonthPicker value={month} onChange={setMonth} max="2026-12" />
      </Section>

      <Section title="Data table">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-pressed={loadingTable}
            onClick={() => setLoadingTable((v) => !v)}
          >
            Loading
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={emptyTable}
            onClick={() => setEmptyTable((v) => !v)}
          >
            Empty
          </Button>
        </div>
        <DataTable
          caption="People"
          data={emptyTable ? [] : ROWS}
          loading={loadingTable}
          empty={
            <EmptyState
              title="No people yet"
              description="Add the first person to start billing."
              action={<Button>Add a person</Button>}
            />
          }
          columns={COLUMNS}
          getRowId={(r) => r.id}
          pageSize={10}
          initialSort={{ id: "name" }}
          rowLabel={(r) => r.name}
          rowActions={() => (
            <>
              <DropdownMenuItem>
                <PencilIcon aria-hidden="true" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive">
                <Trash2Icon aria-hidden="true" /> Remove
              </DropdownMenuItem>
            </>
          )}
          mobile={{
            title: (r) => r.name,
            description: (r) => r.plan,
            trailing: (r) => <StatusBadge status={r.status} />,
          }}
        />
      </Section>

      <Section title="Dialogs and confirmations">
        <div className="flex flex-wrap gap-2">
          <KitDialog />
          <ConfirmAction
            level="undo"
            trigger={<Button variant="outline">Remove (undo)</Button>}
            message="Rice removed from the menu."
            onConfirm={() => setRemoved(true)}
            onUndo={() => setRemoved(false)}
          />
          <ConfirmAction
            level="confirm"
            trigger={
              <Button variant="destructive" className={SOLID_DESTRUCTIVE}>
                Retire (confirm)
              </Button>
            }
            title="Retire Lunch?"
            description="It stops appearing on the menu. Past meals stay in the books."
            confirmLabel="Retire"
            onConfirm={async () => {
              toast.success("Lunch retired");
            }}
          />
          <ConfirmAction
            level="typed"
            trigger={
              <Button variant="destructive" className={SOLID_DESTRUCTIVE}>
                Delete kitchen (typed)
              </Button>
            }
            title="Delete this kitchen?"
            description="Everything in it is removed for good."
            confirmLabel="Delete kitchen"
            phrase="Sample Kitchen"
            onConfirm={async () => {
              toast.success("Deleted");
            }}
          />
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {removed ? "Removed." : "Present."}
        </p>
      </Section>

      <Section title="Form">
        <KitForm />
      </Section>

      <Section title="Toasts">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success("Saved")}>
            Success
          </Button>
          <Button variant="outline" onClick={() => toast.error("Could not save. Try again.")}>
            Error
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.success("Payment recorded", { action: { label: "View", onClick: () => {} } })
            }
          >
            With action
          </Button>
          <Button variant="outline" onClick={() => toast.undo("Person archived", () => {})}>
            Undo
          </Button>
        </div>
      </Section>

      <Section title="Empty, error and not available">
        <EmptyState
          title="No payments this month"
          description="Payments appear here as people pay."
          action={<Button>Record a payment</Button>}
        />
        <Alert variant="destructive">
          <AlertTitle>Could not load payments</AlertTitle>
          <AlertDescription>Check your connection and try again.</AlertDescription>
        </Alert>
        <div className="rounded-xl border p-4">
          <NotAvailable backTo="/" backLabel="Go to your kitchens" />
        </div>
      </Section>

      <Section title="Skeletons">
        <StatsSkeleton />
        <TableSkeleton rows={3} />
        <ListSkeleton rows={2} />
        <FormSkeleton fields={2} />
      </Section>
    </div>
  );
}
