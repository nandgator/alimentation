import {
  PEOPLE_CSV_COLUMNS,
  type PersonFieldChange,
  type PersonImportMode,
  type PersonImportResult,
  type PersonImportRow,
  peopleCsvTemplate,
} from "@alimentation/core";
import { FileTextIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { postCsv } from "@/api";
import {
  AppForm,
  type DataColumn,
  DataTable,
  FormDialog,
  FormField,
  type Status,
  StatusBadge,
  toast,
  useAppForm,
} from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { plural } from "@/format";
import { cn } from "@/lib/utils";
import { liveOn } from "../../../catalogue.ts";
import { useWorkspace } from "../context.tsx";

const COLUMNS = PEOPLE_CSV_COLUMNS.join(",");
const FIELD_WORDS: Record<PersonFieldChange["field"], string> = {
  role: "role",
  name: "name",
  contact: "contact",
  activeFrom: "eating from",
  activeTo: "until",
  services: "services",
};
const ACTION: Record<PersonImportRow["action"], { status: Status; label: string }> = {
  create: { status: "active", label: "Add" },
  update: { status: "pending", label: "Change" },
  unchanged: { status: "projected", label: "No change" },
  error: { status: "overdue", label: "Refused" },
};
const shown = (v: string | null) => (v === null || v === "" ? "nothing" : v);

/** Hands a text to the browser as a file. The mark at the front lets a spreadsheet read the letters right. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Asks the browser for a file without a native control on the page (the design rules keep those inside the kit).
 * TODO(WP1): a FileDrop in the kit would replace this.
 */
function pickFile(accept: string, then: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) then(f);
  };
  input.click();
}

const schema = z.object({
  text: z.string().refine((t) => t.trim() !== "", "Paste the people, or choose a file."),
  mode: z.enum(["merge", "overwrite"]),
});

function ModeCard({
  value,
  title,
  hint,
  tag,
  warn,
}: {
  value: PersonImportMode;
  title: string;
  hint: string;
  tag?: string;
  warn?: boolean;
}) {
  const id = `import-mode-${value}`;
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>
            {title}
            {tag ? (
              warn ? (
                <Badge variant="secondary" className="bg-warning-soft text-warning-foreground">
                  <TriangleAlertIcon aria-hidden="true" data-icon="inline-start" />
                  {tag}
                </Badge>
              ) : (
                <Badge variant="secondary">{tag}</Badge>
              )
            ) : null}
          </FieldTitle>
          <FieldDescription>{hint}</FieldDescription>
        </FieldContent>
        <RadioGroupItem value={value} id={id} />
      </Field>
    </FieldLabel>
  );
}

/** People pasted or read from a file, checked row by row on a preview screen before anything is written (FRM-08). */
export function ImportPeopleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return open ? <ImportBody onOpenChange={onOpenChange} /> : null;
}

function ImportBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const form = useAppForm(schema, { text: "", mode: "merge" as PersonImportMode });
  const [preview, setPreview] = useState<PersonImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const mode = form.watch("mode") as PersonImportMode;
  const several = liveOn(ws.boot.services, ws.boot.today).length >= 2;
  const refused = preview?.summary.error ?? 0;
  const work = preview ? preview.summary.create + preview.summary.update : 0;

  const changed = () => {
    setPreview(null);
    form.clearErrors("root");
  };
  const readFile = (f: File) => {
    void f.text().then((t) => {
      form.setValue("text", t, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
      setFileName(f.name);
      changed();
    });
  };

  const send = (text: string, m: PersonImportMode, dryRun: boolean) =>
    postCsv<PersonImportResult>(`${ws.api}/people/import?mode=${m}&dryRun=${dryRun}`, text);

  const submit = async (v: z.output<typeof schema>) => {
    if (!preview) {
      setPreview(await send(v.text, v.mode, true));
      return;
    }
    const done = await send(v.text, v.mode, false);
    if (!done.committed) {
      setPreview(done);
      throw new Error("Nothing was changed, because some rows were refused.");
    }
    toast.success(
      `${plural(done.summary.create, "person", "people")} added, ${done.summary.update} changed.`,
    );
    onOpenChange(false);
    ws.reload();
  };

  const columns: DataColumn<PersonImportRow>[] = [
    { id: "row", header: "Row", align: "end", cell: (r) => r.row },
    { id: "key", header: "Key", cell: (r) => r.externalKey ?? "-" },
    { id: "name", header: "Name", cell: (r) => r.name },
    {
      id: "what",
      header: "What happens",
      className: "min-w-48 whitespace-normal",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge {...ACTION[r.action]} />
          {r.message ? <span className="text-xs text-muted-foreground">{r.message}</span> : null}
          {r.action === "update"
            ? r.diff.map((d) => (
                <span key={d.field} className="text-xs text-muted-foreground">
                  {FIELD_WORDS[d.field]}: {shown(d.from)} to {shown(d.to)}
                </span>
              ))
            : null}
        </div>
      ),
    },
  ];

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title="Import people"
      description={
        preview
          ? "Check what will happen. Nothing is written until you apply."
          : "One person to a row. Nobody is removed or disabled for being missing, and a role is never changed."
      }
      formId="import-form"
      submitLabel={preview ? "Apply" : "Preview"}
      busyLabel={preview ? "Applying…" : "Checking…"}
      submitting={form.formState.isSubmitting}
      submitDisabled={!!preview && (refused > 0 || work === 0 || !ws.writable)}
      dirty={form.watch("text").trim() !== ""}
    >
      <AppForm form={form} id="import-form" onSubmit={submit}>
        {preview ? (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm font-medium tabular-nums" aria-live="polite">
              {preview.summary.create} to add, {preview.summary.update} to update,{" "}
              {preview.summary.unchanged} unchanged, {plural(preview.summary.error, "error")}
            </p>
            {refused > 0 ? (
              <p className="text-sm text-destructive">
                Nothing is added or changed until every row is fixed.
              </p>
            ) : work === 0 ? (
              <p className="text-sm text-muted-foreground">
                The file matches what is here already, so there is nothing to apply.
              </p>
            ) : null}
            <DataTable
              data={preview.rows}
              columns={columns}
              getRowId={(r) => `${r.row}-${r.externalKey ?? ""}-${r.action}`}
              caption="Preview"
              searchable={false}
              stickyFirst={false}
              pageSize={25}
              mobile={{
                title: (r) => `Row ${r.row}: ${r.name || "No name"}`,
                description: (r) => (
                  <>
                    {r.externalKey ? <span className="block">{r.externalKey}</span> : null}
                    {r.message ? <span className="block">{r.message}</span> : null}
                    {r.action === "update"
                      ? r.diff.map((d) => (
                          <span key={d.field} className="block">
                            {FIELD_WORDS[d.field]}: {shown(d.from)} to {shown(d.to)}
                          </span>
                        ))
                      : null}
                  </>
                ),
                trailing: (r) => <StatusBadge {...ACTION[r.action]} />,
              }}
            />
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={changed}>
                Change the file
              </Button>
            </div>
          </div>
        ) : (
          <>
            <FormField
              name="text"
              label="People"
              description={
                <>
                  The first line names the columns:{" "}
                  <code className="block rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">
                    {COLUMNS}
                  </code>
                  Only name and role are needed. Role is consumer, supplier (a cook) or admin.
                  {several
                    ? " To say which services a consumer takes, add a services column with their names between | and the first date."
                    : ""}
                </>
              }
            >
              {(f) => (
                <Textarea
                  {...f}
                  rows={6}
                  spellCheck={false}
                  className="font-mono text-xs break-all"
                  onChange={(e) => {
                    f.onChange(e);
                    changed();
                  }}
                />
              )}
            </FormField>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside does the same by keyboard */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files[0];
                if (f) readFile(f);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border border-dashed border-input p-4 text-center",
                over && "border-primary bg-accent",
              )}
            >
              {fileName ? (
                <p className="flex items-center gap-2 text-sm">
                  <FileTextIcon aria-hidden="true" className="size-4" />
                  {fileName}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Drop a file here, or</p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => pickFile(".csv,.tsv,.txt,text/csv,text/plain", readFile)}
                >
                  <UploadIcon aria-hidden="true" data-icon="inline-start" />
                  Choose a file
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadCsv("people-template.csv", peopleCsvTemplate())}
                >
                  Download a template
                </Button>
              </div>
            </div>

            <FieldSet>
              <FieldLegend variant="label">If a person is already there</FieldLegend>
              <RadioGroup
                aria-label="If a person is already there"
                value={mode}
                onValueChange={(v) => {
                  form.setValue("mode", v as PersonImportMode, { shouldDirty: true });
                  changed();
                }}
              >
                <ModeCard
                  value="merge"
                  title="Merge"
                  tag="Recommended"
                  hint="Set what the file gives. A blank cell leaves what is there."
                />
                <ModeCard
                  value="overwrite"
                  title="Overwrite"
                  tag="Clears blanks"
                  warn
                  hint="Set everything the file gives. A blank contact or date clears it."
                />
              </RadioGroup>
            </FieldSet>
          </>
        )}
      </AppForm>
    </FormDialog>
  );
}
