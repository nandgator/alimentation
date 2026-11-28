import { DEFAULT_POLICY, dayName, must, type PolicyView, type Weekday } from "@alimentation/core";
import { useMemo, useState } from "react";
import { z } from "zod";
import { getJson, postJson } from "@/api";
import { CountInput, DateField, FormField, toast, useAppForm } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { date } from "../../../../format.ts";
import { useWorkspace } from "../../context.tsx";
import {
  ABOUT_DATE,
  aboutDate,
  FormModal,
  GroupField,
  LoadError,
  Section,
  Segmented,
} from "../parts.tsx";
import {
  type RulesFields,
  ruleCards,
  rulesDoc,
  rulesFields,
  rulesProblems,
  WEEK,
} from "../rulesForm.ts";
import { useLoad } from "../use-load.ts";

const rulesSchema = (money: boolean) =>
  z
    .object({
      from: z.string(),
      workingDays: z.array(z.number()),
      holidays: z.enum(["confirmed", "all"]),
      leavePct: z.string(),
      feeDays: z.string(),
      payments: z.enum(["claim_confirm", "direct"]),
      close: z.enum(["off", "manual", "auto"]),
      closeDays: z.string(),
      afterClose: z.enum(["flag", "block"]),
      backdating: z.enum(["none", "current_month", "unrestricted"]),
      cutoffDays: z.string(),
      cutoffTime: z.string(),
    })
    .superRefine((v, ctx) => {
      for (const p of rulesProblems(v as RulesFields, money))
        ctx.addIssue({ code: "custom", path: [p.path], message: p.message });
    });

/**
 * The rules that apply from a date (FRM-12, FRM-19): short choices are toggle groups, the working days are seven
 * equal chips, and "Applies from" is first. A kitchen without money is not shown or asked the money rules.
 */
function RulesForm({
  current,
  onClose,
  onDone,
}: {
  current: PolicyView;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const money = ws.money;
  const schema = useMemo(() => rulesSchema(money), [money]);
  const form = useAppForm(schema, rulesFields(current, ws.boot.today));
  const v = form.watch();
  const set = <K extends keyof RulesFields>(key: K, value: RulesFields[K]) =>
    form.setValue(key, value as never, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  const dayError = form.formState.errors.workingDays?.message as string | undefined;
  return (
    <FormModal
      form={form}
      title="Change the rules"
      description={`These rules apply to months starting on or after the date below. Earlier months keep the rules they were ${money ? "billed" : "counted"} under.`}
      submitLabel="Save rules"
      busyLabel="Saving…"
      onClose={onClose}
      serverFields={{ [ABOUT_DATE]: "from" }}
      onSubmit={async (values) => {
        try {
          await postJson(`${ws.api}/policies`, {
            effectiveFrom: values.from,
            doc: rulesDoc(values as RulesFields, current, money),
          });
        } catch (e) {
          throw aboutDate(e);
        }
        toast.success(`Rules apply from ${date(values.from)}.`);
        onDone();
      }}
    >
      <FormField name="from" label="Applies from">
        {(f) => (
          <DateField
            id={f.id}
            aria-invalid={f["aria-invalid"]}
            aria-describedby={f["aria-describedby"]}
            value={f.value}
            onChange={f.onChange}
            onBlur={f.onBlur}
            presets={false}
            today={ws.boot.today}
            label="Rules apply from"
          />
        )}
      </FormField>

      <GroupField label="Meals are served on" error={dayError}>
        {(labelId) => (
          <ToggleGroup
            multiple
            variant="outline"
            spacing={1}
            aria-labelledby={labelId}
            value={v.workingDays.map(String)}
            onValueChange={(next) => set("workingDays", next.map(Number))}
            className="grid w-full grid-cols-7"
          >
            {WEEK.map((d) => (
              <ToggleGroupItem
                key={d}
                value={String(d)}
                aria-label={dayName(d as Weekday)}
                className="min-w-0 px-0 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground"
              >
                {dayName(d as Weekday)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </GroupField>

      <GroupField label="Holidays that cancel a meal">
        {(labelId) => (
          <Segmented
            labelledBy={labelId}
            value={v.holidays}
            onChange={(x) => set("holidays", x)}
            options={[
              { value: "confirmed", label: "Only confirmed holidays" },
              { value: "all", label: "All listed holidays" },
            ]}
          />
        )}
      </GroupField>

      {money ? (
        <>
          <FormField
            name="leavePct"
            label="Charge on a leave day"
            description="The share of the day's meal price. 0 for nothing."
          >
            {(f) => (
              <InputGroup>
                <InputGroupInput
                  {...f}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText aria-hidden="true">%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            )}
          </FormField>
          <FormField
            name="feeDays"
            label="Monthly fee applies from"
            description="Days with a meal needed in the month. 0 means no monthly fee."
          >
            {(f) => <CountInput {...f} maxLength={2} />}
          </FormField>
          <GroupField label="Payments">
            {(labelId) => (
              <Segmented
                labelledBy={labelId}
                value={v.payments}
                onChange={(x) => set("payments", x)}
                options={[
                  { value: "claim_confirm", label: "Consumers claim, an admin confirms" },
                  { value: "direct", label: "Recorded directly" },
                ]}
              />
            )}
          </GroupField>
        </>
      ) : null}

      <GroupField
        label="Month end"
        description="The window for everyone to catch up. After it, meals and leave freeze; payments carry on."
      >
        {(labelId) => (
          <Segmented
            labelledBy={labelId}
            value={v.close}
            onChange={(x) => set("close", x)}
            options={[
              { value: "off", label: "Never closed" },
              { value: "manual", label: "Closed by an admin" },
              { value: "auto", label: "Closes by itself" },
            ]}
          />
        )}
      </GroupField>
      {v.close === "auto" ? (
        <FormField name="closeDays" label="Days after month end">
          {(f) => <CountInput {...f} maxLength={2} />}
        </FormField>
      ) : null}
      {v.close !== "off" ? (
        <GroupField label="Entries after close">
          {(labelId) => (
            <Segmented
              labelledBy={labelId}
              value={v.afterClose}
              onChange={(x) => set("afterClose", x)}
              options={[
                { value: "flag", label: "Allowed, and flagged" },
                { value: "block", label: "Not allowed" },
              ]}
            />
          )}
        </GroupField>
      ) : null}

      {money ? (
        <GroupField label="New prices may start">
          {(labelId) => (
            <Segmented
              labelledBy={labelId}
              value={v.backdating}
              onChange={(x) => set("backdating", x)}
              options={[
                { value: "none", label: "Only from today" },
                { value: "current_month", label: "From the start of this month" },
                { value: "unrestricted", label: "Any date" },
              ]}
            />
          )}
        </GroupField>
      ) : null}

      <FormField
        name="cutoffDays"
        label="Exceptions due, days before"
        description="Empty means any time. Anything added after its day is always marked late."
      >
        {(f) => <CountInput {...f} maxLength={1} />}
      </FormField>
      {v.cutoffDays.trim() !== "" ? (
        <FormField name="cutoffTime" label="By this time">
          {(f) => <Input {...f} type="time" />}
        </FormField>
      ) : null}
    </FormModal>
  );
}

/** The rules each month follows. A kitchen that does not track money is not shown the money rules. */
export function RulesTab() {
  const ws = useWorkspace();
  const pols = useLoad(
    () => getJson<{ effectiveFrom: string; doc: PolicyView }[]>(`${ws.api}/policies`),
    ws.api,
  );
  const [open, setOpen] = useState(false);
  const current = pols.data?.length
    ? must(pols.data[pols.data.length - 1]).doc
    : (ws.boot.policy ?? DEFAULT_POLICY);
  const latest = pols.data?.length ? must(pols.data[pols.data.length - 1]).effectiveFrom : null;
  return (
    <div className="flex flex-col gap-4">
      <LoadError error={pols.error} onRetry={pols.reload} />
      <Section
        title="Rules for this kitchen"
        description={
          latest
            ? `In force from ${date(latest)}. A change applies from the date you choose.`
            : "A change applies from the date you choose."
        }
        actions={
          <Button type="button" disabled={!ws.writable} onClick={() => setOpen(true)}>
            Change the rules
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {ruleCards(current, ws.money).map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent className="font-medium">{c.value}</CardContent>
            </Card>
          ))}
        </div>
      </Section>
      {open ? (
        <RulesForm
          current={current}
          onClose={() => setOpen(false)}
          onDone={() => {
            pols.reload();
            ws.reload();
          }}
        />
      ) : null}
    </div>
  );
}
