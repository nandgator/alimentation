import type { Holiday, HolidayImportMode, HolidayImportResult } from "@alimentation/core";
import { FileUpIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, postJson } from "@/api";
import {
  ConfirmAction,
  type DataColumn,
  DataTable,
  DateField,
  EmptyState,
  FormField,
  StatusBadge,
  toast,
  useAppForm,
} from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { date } from "../../../../format.ts";
import { useWorkspace } from "../../context.tsx";
import { CheckRow, FormModal, GroupField, Section } from "../parts.tsx";

const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120, "Use 120 characters or fewer"),
    from: z.string().min(1, "Choose the date"),
    to: z.string(),
    confirmed: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.to !== "" && v.from !== "" && v.to < v.from)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "The last day cannot be before the first day",
      });
  });

/** One holiday, or a run of days in a row (one holiday is made for each, weekends too). */
function AddHoliday({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const form = useAppForm(holidaySchema, {
    name: "",
    from: ws.boot.today,
    to: "",
    confirmed: true,
  });
  const from = form.watch("from");
  const to = form.watch("to");
  const confirmed = form.watch("confirmed");
  return (
    <FormModal
      form={form}
      title="Add a holiday"
      description="For several days in a row, give the last day too: one holiday is added for each day from the first to the last, weekends included."
      submitLabel="Add holiday"
      busyLabel="Adding…"
      onClose={onClose}
      onSubmit={async (v) => {
        const range = v.to !== "" && v.to !== v.from;
        const made = await postJson<{ ids: string[] }>(
          `${ws.api}/holidays`,
          range
            ? { name: v.name, from: v.from, to: v.to, confirmed: v.confirmed }
            : { name: v.name, date: v.from, confirmed: v.confirmed },
        );
        toast.success(
          made.ids.length > 1 ? `${made.ids.length} holidays added.` : `${v.name} added.`,
        );
        onDone();
      }}
    >
      <FormField name="name" label="Name">
        {(f) => <Input {...f} maxLength={120} autoComplete="off" />}
      </FormField>
      <FormField name="from" label={to ? "First day" : "Date"}>
        {(f) => (
          <DateField
            id={f.id}
            aria-invalid={f["aria-invalid"]}
            aria-describedby={f["aria-describedby"]}
            value={f.value}
            onChange={(v) => {
              f.onChange(v);
              // A last day before the first is cleared rather than left to fail.
              if (to !== "" && to < v) form.setValue("to", "", { shouldDirty: true });
            }}
            onBlur={f.onBlur}
            today={ws.boot.today}
            label="First day of the holiday"
          />
        )}
      </FormField>
      <FormField name="to" label="Last day (optional)" description="Leave empty for a single day.">
        {(f) => (
          <div className="flex items-center gap-2">
            <DateField
              id={f.id}
              aria-invalid={f["aria-invalid"]}
              aria-describedby={f["aria-describedby"]}
              value={f.value}
              onChange={f.onChange}
              onBlur={f.onBlur}
              min={from || undefined}
              presets={false}
              today={ws.boot.today}
              placeholder="No last day"
              label="Last day of the holiday"
            />
            {f.value ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => form.setValue("to", "", { shouldDirty: true })}
              >
                Clear
              </Button>
            ) : null}
          </div>
        )}
      </FormField>
      <CheckRow
        checked={confirmed}
        onChange={(c) => form.setValue("confirmed", c, { shouldDirty: true })}
        title="Confirmed"
        description="A meal is not served and not billed. Leave it off for a holiday that may change."
      />
    </FormModal>
  );
}

const IMPORT_EXAMPLE = "name,from,to,location,confirmed\nDiwali break,2026-11-08,2026-11-11,,yes";

const ACTION: Record<
  HolidayImportResult["rows"][number]["action"],
  { status: "confirmed" | "pending" | "projected" | "disputed"; label: string }
> = {
  create: { status: "confirmed", label: "Add" },
  replace: { status: "pending", label: "Replace" },
  skip: { status: "projected", label: "Skip" },
  error: { status: "disputed", label: "Refused" },
};

const MODES: { value: HolidayImportMode; title: string; hint: string; warn?: string }[] = [
  {
    value: "merge",
    title: "Merge",
    hint: "Keep what is there and add the new ones. The same day, name and place is skipped.",
  },
  {
    value: "overwrite",
    title: "Overwrite",
    hint: "Replace what is there on the days in the list. Other days are left alone.",
    warn: "Replaces holidays",
  },
];

/** Holidays pasted or read from a file, checked row by row before anything is written (FRM-08). */
function ImportHolidays({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const form = useAppForm(
    z.object({
      csv: z.string().refine((t) => t.trim() !== "", "Paste the holidays, or choose a file"),
      mode: z.enum(["merge", "overwrite"]),
      partial: z.boolean(),
    }),
    { csv: "", mode: "merge", partial: false },
  );
  const [preview, setPreview] = useState<HolidayImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const csv = form.watch("csv");
  const mode = form.watch("mode");
  const partial = form.watch("partial");
  // A change to what is pasted or how it is applied makes the preview out of date.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what the preview was made from
  useEffect(() => setPreview(null), [csv, mode]);
  const refused = preview?.summary.error ?? 0;
  const take = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    void file.text().then((t) => form.setValue("csv", t, { shouldDirty: true }));
  };
  const toAdd = preview ? preview.summary.create + preview.summary.replace : 0;
  return (
    <FormModal
      form={form}
      title="Import holidays"
      description="Each holiday is one line. The first line names the columns: name, from, to, location, confirmed. Only name and from (or date) are needed."
      submitLabel={preview ? `Add ${toAdd} ${toAdd === 1 ? "holiday" : "holidays"}` : "Preview"}
      busyLabel={preview ? "Adding…" : "Checking…"}
      onClose={onClose}
      onSubmit={async (v) => {
        const body = (dryRun: boolean) => ({
          mode: v.mode,
          dryRun,
          partial: v.partial,
          csv: v.csv,
        });
        if (!preview) {
          setPreview(await postJson<HolidayImportResult>(`${ws.api}/holidays/bulk`, body(true)));
          return false;
        }
        if (refused > 0 && !v.partial)
          throw new Error(
            "Some rows are refused. Tick the box to add the rest, or fix them and preview again.",
          );
        if (toAdd === 0) throw new Error("There is nothing to add.");
        const done = await postJson<HolidayImportResult>(`${ws.api}/holidays/bulk`, body(false));
        if (!done.committed) {
          setPreview(done);
          throw new Error("Nothing was added, because some rows were refused.");
        }
        toast.success(`${done.summary.create + done.summary.replace} holidays added.`);
        onDone();
      }}
    >
      <div
        role="group"
        aria-label="File to import"
        className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          take(e.dataTransfer.files[0]);
        }}
      >
        <Button type="button" variant="outline" onClick={() => picker.current?.click()}>
          <FileUpIcon aria-hidden="true" data-icon="inline-start" />
          Choose a file
        </Button>
        <p className="text-sm text-muted-foreground">
          {fileName ? `Read ${fileName}.` : "A CSV or TSV file, or drop it here."}
        </p>
        {/* TODO(WP1): a FileButton in the app kit, so no native file input is needed outside it. */}
        <input
          ref={picker}
          type="file"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <FormField
        name="csv"
        label="Or paste them here"
        description={
          <>
            For example: <code className="break-words whitespace-pre-wrap">{IMPORT_EXAMPLE}</code>
          </>
        }
      >
        {(f) => (
          <Textarea {...f} rows={5} spellCheck={false} className="font-mono text-base md:text-sm" />
        )}
      </FormField>
      <GroupField label="If a day already has a holiday">
        {(labelId) => (
          <RadioGroup
            aria-labelledby={labelId}
            value={mode}
            onValueChange={(v) =>
              form.setValue("mode", v as HolidayImportMode, { shouldDirty: true })
            }
          >
            {MODES.map((m) => (
              <label
                key={m.value}
                htmlFor={`import-${m.value}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-2.5 has-data-checked:border-primary/40 has-data-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <RadioGroupItem id={`import-${m.value}`} value={m.value} className="mt-0.5" />
                <FieldContent>
                  <FieldTitle>
                    {m.title}
                    {m.warn ? (
                      <Badge
                        variant="secondary"
                        className="bg-warning-soft text-warning-foreground"
                      >
                        <TriangleAlertIcon aria-hidden="true" data-icon="inline-start" />
                        {m.warn}
                      </Badge>
                    ) : null}
                  </FieldTitle>
                  <FieldDescription>{m.hint}</FieldDescription>
                </FieldContent>
              </label>
            ))}
          </RadioGroup>
        )}
      </GroupField>
      {preview ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="font-medium">
            {preview.summary.create} to add, {preview.summary.replace} to replace
            {preview.summary.removed > 0 ? ` (taking away ${preview.summary.removed})` : ""},{" "}
            {preview.summary.skip} skipped, {preview.summary.error} refused.
          </p>
          <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border" aria-label="Preview">
            {preview.rows.map((r) => (
              <li
                key={`${r.row}-${r.date ?? ""}-${r.action}-${r.name}-${r.message}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm"
              >
                <StatusBadge status={ACTION[r.action].status} label={ACTION[r.action].label} />
                <span className="font-medium">{r.name}</span>
                {r.date ? <span className="tabular-nums">{date(r.date)}</span> : null}
                <span className="w-full text-muted-foreground">
                  Row {r.row}. {r.message}
                </span>
              </li>
            ))}
          </ul>
          {refused > 0 ? (
            <CheckRow
              checked={partial}
              onChange={(c) => form.setValue("partial", c, { shouldDirty: true })}
              title="Add the rest and leave out the refused rows"
              description="Otherwise nothing is added."
            />
          ) : null}
        </div>
      ) : null}
    </FormModal>
  );
}

/** The kitchen's holidays, newest first. Only confirmed ones cancel a meal, unless the rules say every listed one does. */
export function HolidaysTab() {
  const ws = useWorkspace();
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const holidays = ws.boot.holidays;

  const columns: DataColumn<Holiday>[] = [
    { id: "date", header: "Date", cell: (h) => date(h.date), sort: (h) => h.date },
    {
      id: "name",
      header: "Name",
      cell: (h) => h.name,
      sort: (h) => h.name,
      search: (h) => h.name,
    },
    {
      id: "status",
      header: "Status",
      cell: (h) => (
        <StatusBadge
          status={h.confirmed ? "confirmed" : "pending"}
          label={h.confirmed ? "Confirmed" : "Tentative"}
        />
      ),
      facet: { label: "Status", value: (h) => (h.confirmed ? "Confirmed" : "Tentative") },
    },
  ];

  const flip = async (h: Holiday, confirmed: boolean) => {
    await api.patch(`${ws.api}/holidays/${h.id}`, { confirmed });
    ws.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Holidays"
        description="Days with no meal. Confirmed holidays are not served and not billed."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!ws.writable}
              onClick={() => setDialog("import")}
            >
              <FileUpIcon aria-hidden="true" data-icon="inline-start" />
              Import
            </Button>
            <Button type="button" disabled={!ws.writable} onClick={() => setDialog("add")}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              Add a holiday
            </Button>
          </>
        }
      >
        <DataTable
          data={holidays}
          columns={columns}
          getRowId={(h) => h.id}
          caption="Holidays"
          searchLabel="Search holidays"
          initialSort={{ id: "date", desc: true }}
          rowLabel={(h) => h.name}
          rowActions={(h) =>
            !ws.writable ? (
              <DropdownMenuItem disabled>This kitchen cannot be changed now</DropdownMenuItem>
            ) : (
              <>
                <ConfirmAction
                  level="undo"
                  message={h.confirmed ? `${h.name} is now tentative.` : `${h.name} is confirmed.`}
                  onConfirm={() => flip(h, !h.confirmed)}
                  onUndo={() => flip(h, h.confirmed)}
                  trigger={
                    <DropdownMenuItem disabled={!ws.writable}>
                      {h.confirmed ? "Make tentative" : "Confirm"}
                    </DropdownMenuItem>
                  }
                />
                <ConfirmAction
                  level="undo"
                  message={`${h.name} removed.`}
                  onConfirm={async () => {
                    await api.del(`${ws.api}/holidays/${h.id}`);
                    ws.reload();
                  }}
                  onUndo={async () => {
                    await postJson(`${ws.api}/holidays`, {
                      name: h.name,
                      date: h.date,
                      location: h.location,
                      confirmed: h.confirmed,
                    });
                    ws.reload();
                  }}
                  trigger={
                    <DropdownMenuItem variant="destructive" disabled={!ws.writable}>
                      Remove
                    </DropdownMenuItem>
                  }
                />
              </>
            )
          }
          mobile={{
            title: (h) => h.name,
            description: (h) => date(h.date),
            trailing: (h) => (
              <StatusBadge
                status={h.confirmed ? "confirmed" : "pending"}
                label={h.confirmed ? "Confirmed" : "Tentative"}
              />
            ),
          }}
          empty={
            <EmptyState
              title="No holidays yet"
              description="Add the days the kitchen does not cook, or import a list."
              action={
                <Button type="button" disabled={!ws.writable} onClick={() => setDialog("add")}>
                  Add a holiday
                </Button>
              }
            />
          }
        />
      </Section>
      {dialog === "add" ? <AddHoliday onClose={() => setDialog(null)} onDone={ws.reload} /> : null}
      {dialog === "import" ? (
        <ImportHolidays onClose={() => setDialog(null)} onDone={ws.reload} />
      ) : null}
    </div>
  );
}
