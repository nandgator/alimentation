import type { Role } from "@alimentation/core";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { z } from "zod";
import { api, postJson } from "@/api";
import { AppForm, DateField, FormDialog, FormField, toast, useAppForm } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { inOrder, liveOn } from "../../../catalogue.ts";
import { rowsAfter, type Slot, sameRows, slotOf } from "../../../enrolment.ts";
import { useWorkspace } from "../context.tsx";
import { ROLE_LABEL } from "../sections.ts";
import type { Member } from "./model.ts";

const slotSchema = z.object({ on: z.boolean(), from: z.string(), to: z.string() });

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(120, "Use 120 characters or fewer."),
    role: z.enum(["consumer", "supplier", "admin"]),
    from: z.string(),
    to: z.string(),
    contact: z.string().max(200, "Use 200 characters or fewer."),
    key: z
      .string()
      .max(64, "Use 64 characters or fewer.")
      .regex(
        /^([A-Za-z0-9][A-Za-z0-9._:/#-]*)?$/,
        "Use letters, digits and . _ : / # - only, starting with a letter or digit.",
      ),
    slots: z.record(z.string(), slotSchema),
  })
  .superRefine((v, ctx) => {
    if (v.role !== "consumer") return;
    if (v.from && v.to && v.to < v.from)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Until must not be before Eating from.",
      });
    for (const [id, s] of Object.entries(v.slots)) {
      if (!s.on) continue;
      if (!s.from)
        ctx.addIssue({
          code: "custom",
          path: ["slots", id, "from"],
          message: "Choose a start date.",
        });
      else if (s.to && s.to < s.from)
        ctx.addIssue({
          code: "custom",
          path: ["slots", id, "to"],
          message: "Until must not be before the start.",
        });
    }
  });

/** A date that may be left empty: the calendar, and a button to take it away again. */
function OptionalDate({ label, ...props }: ComponentProps<typeof DateField> & { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <DateField {...props} label={label} presets={false} placeholder="No end date" />
      </div>
      {props.value ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Clear ${label}`}
          onClick={() => props.onChange("")}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

const ROLES: readonly Role[] = ["consumer", "supplier", "admin"];

/** One choice among a few, drawn as a card with a title and a line under it. */
function RoleCard({ value, title, hint }: { value: Role; title: string; hint: string }) {
  const id = `role-${value}`;
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{hint}</FieldDescription>
        </FieldContent>
        <RadioGroupItem value={value} id={id} />
      </Field>
    </FieldLabel>
  );
}

/**
 * Add a person, or edit one (FRM-04, FRM-13): the few things everyone needs first, the rarely used ones (contact, key,
 * until) under "More details", and every optional field marked so. When the person is several rows of the server
 * (an owner who also cooks) the name and the contact go to each of them.
 */
export function PersonDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A form is made fresh each time the dialog opens, so nothing of the last person is left in it.
  return open ? <PersonDialogBody member={member} onOpenChange={onOpenChange} /> : null;
}

function PersonDialogBody({
  member,
  onOpenChange,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
}) {
  const ws = useWorkspace();
  const today = ws.boot.today;
  // The row that carries the dates, the key and the services: the consumer's, else the main one.
  const target = member ? (member.rows.find((r) => r.role === "consumer") ?? member.main) : null;
  const keyFixed = !!target?.externalKey;
  const mine = ws.boot.enrolments.filter((e) => e.personId === target?.id);
  const choosable = inOrder(liveOn(ws.boot.services, today));
  const askServices = !!target && target.role === "consumer" && choosable.length >= 2;

  const form = useAppForm(schema, {
    name: member?.main.name ?? "",
    role: (target?.role ?? "consumer") as Role,
    from: target ? (target.activeFrom ?? "") : today,
    to: target?.activeTo ?? "",
    contact: member?.main.contact ?? "",
    key: target?.externalKey ?? "",
    slots: Object.fromEntries(
      choosable.map((sv) => [sv.id, slotOf(mine, sv.id, target?.activeFrom ?? today)]),
    ),
  });
  const [more, setMore] = useState(
    !!(member?.main.contact || target?.externalKey || target?.activeTo),
  );
  const role = form.watch("role");
  const slots = form.watch("slots") as Record<string, Slot>;
  const errors = form.formState.errors;
  // A problem in a field that is folded away would be invisible, so it opens the fold.
  const hidden = !!(errors.contact || errors.key || errors.to);
  const consumer = role === "consumer";
  const formId = "person-form";

  const submit = async (v: z.output<typeof schema>) => {
    if (member && target) {
      const dates = consumer
        ? { activeFrom: v.from || null, activeTo: v.to || null }
        : { activeFrom: target.activeFrom, activeTo: target.activeTo };
      for (const r of member.rows) {
        const own = r.id === target.id;
        const body = { name: v.name, contact: v.contact || null, ...(own ? dates : {}) };
        await api.patch(
          `${ws.api}/people/${r.id}`,
          own && v.key && !keyFixed ? { ...body, externalKey: v.key } : body,
        );
      }
      if (askServices) {
        const next = rowsAfter(mine, v.slots as Record<string, Slot>);
        if (!sameRows(next, mine))
          await api.put(`${ws.api}/people/${target.id}/services`, { services: next });
      }
      toast.success("Saved.");
    } else {
      await postJson(`${ws.api}/people`, {
        name: v.name,
        role: v.role,
        contact: v.contact || null,
        activeFrom: v.role === "consumer" ? v.from || null : null,
        activeTo: v.role === "consumer" ? v.to || null : null,
        externalKey: v.key || null,
      });
      toast.success(`${v.name} added.`);
    }
    onOpenChange(false);
    ws.reload();
  };

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={member ? `Edit ${member.main.name}` : "Add a person"}
      formId={formId}
      submitLabel={member ? "Save" : "Add person"}
      busyLabel="Saving…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <AppForm form={form} id={formId} onSubmit={submit} serverFields={{ conflict: "key" }}>
        <FormField name="name" label="Name" required>
          {(f) => <Input {...f} maxLength={120} autoComplete="off" />}
        </FormField>

        {member ? (
          <p className="text-sm text-muted-foreground">
            {member.roles.map((r) => ROLE_LABEL[r]).join(" and ")}. A role is set when someone is
            added and does not change.
          </p>
        ) : (
          <FieldSet>
            <FieldLegend variant="label">Role</FieldLegend>
            <RadioGroup
              aria-label="Role"
              value={role}
              onValueChange={(v) => form.setValue("role", v as Role, { shouldDirty: true })}
            >
              {ROLES.map((r) => (
                <RoleCard
                  key={r}
                  value={r}
                  title={ROLE_LABEL[r]}
                  hint={
                    r === "consumer"
                      ? ws.money
                        ? "Eats here, logs their own meals and gets a bill."
                        : "Eats here and logs their own meals."
                      : r === "supplier"
                        ? "Cooks and serves, and logs what was made."
                        : "Runs the kitchen: people, setup and the books."
                  }
                />
              ))}
            </RadioGroup>
          </FieldSet>
        )}

        {consumer ? (
          <FormField name="from" label="Eating from">
            {(f) => (
              <DateField
                id={f.id}
                value={f.value}
                onChange={f.onChange}
                onBlur={f.onBlur}
                today={today}
                label="Eating from"
                aria-invalid={f["aria-invalid"]}
                aria-describedby={f["aria-describedby"]}
              />
            )}
          </FormField>
        ) : null}

        {askServices ? (
          <FieldSet>
            <FieldLegend variant="label">Services</FieldLegend>
            <FieldDescription>
              What they eat, and from when. Days in a service they do not take are not billed.
            </FieldDescription>
            {choosable.map((sv) => {
              const on = slots[sv.id]?.on ?? false;
              return (
                <div key={sv.id} className="flex flex-col gap-3 rounded-lg border p-3">
                  <label
                    htmlFor={`service-${sv.id}`}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <Checkbox
                      id={`service-${sv.id}`}
                      checked={on}
                      onCheckedChange={(c) =>
                        form.setValue(`slots.${sv.id}.on`, c === true, { shouldDirty: true })
                      }
                    />
                    {sv.name}
                  </label>
                  {on ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField name={`slots.${sv.id}.from`} label={`${sv.name} from`}>
                        {(f) => (
                          <DateField
                            id={f.id}
                            value={f.value}
                            onChange={f.onChange}
                            onBlur={f.onBlur}
                            today={today}
                            label={`${sv.name} from`}
                            aria-invalid={f["aria-invalid"]}
                            aria-describedby={f["aria-describedby"]}
                          />
                        )}
                      </FormField>
                      <FormField name={`slots.${sv.id}.to`} label={`${sv.name} until (optional)`}>
                        {(f) => (
                          <OptionalDate
                            id={f.id}
                            value={f.value}
                            onChange={f.onChange}
                            onBlur={f.onBlur}
                            today={today}
                            label={`${sv.name} until`}
                            aria-invalid={f["aria-invalid"]}
                            aria-describedby={f["aria-describedby"]}
                          />
                        )}
                      </FormField>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </FieldSet>
        ) : null}

        {!member && consumer && choosable.length >= 2 ? (
          <p className="text-sm text-muted-foreground">
            A new consumer takes every service. You can change that after adding them.
          </p>
        ) : null}

        <Collapsible open={more || hidden} onOpenChange={setMore}>
          <CollapsibleTrigger
            render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}
          >
            More details
            <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-5 pt-3">
              <FormField
                name="contact"
                label="Contact (optional)"
                description="Only you can see this. It is stored encrypted."
              >
                {(f) => <Input {...f} maxLength={200} autoComplete="off" />}
              </FormField>
              <FormField
                name="key"
                label="Key (optional)"
                description={
                  keyFixed
                    ? "Your own code for them. It is fixed once set."
                    : "Your own code, such as a room number. Once set it cannot change."
                }
              >
                {(f) => (
                  <Input
                    {...f}
                    maxLength={64}
                    readOnly={keyFixed}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                )}
              </FormField>
              {consumer ? (
                <FormField name="to" label="Until (optional)">
                  {(f) => (
                    <OptionalDate
                      id={f.id}
                      value={f.value}
                      onChange={f.onChange}
                      onBlur={f.onBlur}
                      today={today}
                      label="Until"
                      aria-invalid={f["aria-invalid"]}
                      aria-describedby={f["aria-describedby"]}
                    />
                  )}
                </FormField>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </AppForm>
    </FormDialog>
  );
}
