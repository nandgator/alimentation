import { PAY_METHODS, type PayMethod } from "@alimentation/core";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import { postJson } from "@/api";
import {
  AppForm,
  DateField,
  FormDialog,
  FormField,
  MoneyInput,
  toast,
  useAppForm,
} from "@/components/app";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { money, monthLong, rupeesText, toPaise } from "@/format";
import { useWorkspace } from "../context.tsx";
import { dueOf, rememberedMethod, rememberMethod } from "./claims.ts";

const REF_MAX = 300;

/** What a server refusal is about, so it lands under the field and not in a toast. */
const SERVER_FIELDS = {
  AMOUNT: "amount",
  METHOD: "method",
  MONTH_RANGE: "forMonth",
  NOT_A_DATE: "paidAt",
  PAID_IN_FUTURE: "paidAt",
  UNKNOWN_PERSON: "consumerId",
  NOT_A_CONSUMER: "consumerId",
  FOR_SELF_ONLY: "consumerId",
} as const;

/**
 * "I paid" for a consumer, "Record a payment" for the admin (FRM-07, FRM-11). The form opens filled in: the amount
 * due, the current month, the method used last time and today's date. It makes a claim, which waits for the cook.
 */
export function PayDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const { today, currentMonth } = ws.boot;
  const forSelf = ws.role === "consumer";
  const consumers = useMemo(
    () => ws.boot.people.filter((p) => p.role === "consumer"),
    [ws.boot.people],
  );
  const months = useMemo(() => [...ws.boot.months].reverse(), [ws.boot.months]);

  const schema = useMemo(
    () =>
      z.object({
        consumerId: z.string().min(1, "Choose who paid."),
        forMonth: z.string().min(1, "Choose the month it is for."),
        amount: z.string().refine((v) => {
          const p = toPaise(v);
          return p !== null && p > 0;
        }, "Enter the amount in rupees, like 450 or 450.50."),
        method: z.enum(PAY_METHODS),
        paidAt: z
          .string()
          .min(1, "Choose the day it was paid.")
          .refine((d) => d <= today, "It cannot be paid on a day that has not come."),
        refNote: z.string().max(REF_MAX, `Keep it to ${REF_MAX} characters.`),
      }),
    [today],
  );

  const defaults = () => {
    const who = forSelf ? ws.boot.me.personId : (consumers[0]?.id ?? "");
    const owing = forSelf ? dueOf(ws.boot.statements, who) : null;
    return {
      consumerId: who,
      forMonth: currentMonth as string,
      amount: owing && owing.due > 0 ? rupeesText(owing.due) : "",
      method: rememberedMethod(ws.slug) as PayMethod,
      paidAt: today as string,
      refNote: "",
    };
  };

  const form = useAppForm(schema, defaults());
  // Each opening starts from fresh figures, not from what was left in the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the opening matters
  useEffect(() => {
    if (open) form.reset(defaults());
  }, [open]);

  const note = form.watch("refNote") ?? "";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={forSelf ? "I paid" : "Record a payment"}
      description={
        forSelf
          ? "It shows as pending until the cook confirms it."
          : "It is pending until the cook confirms it."
      }
      formId="pay-form"
      submitLabel={forSelf ? "Send claim" : "Record payment"}
      busyLabel="Sending…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset(defaults())}
    >
      <AppForm
        id="pay-form"
        form={form}
        serverFields={SERVER_FIELDS}
        onSubmit={async (v) => {
          const paise = toPaise(v.amount);
          if (paise === null) return;
          await postJson(`${ws.api}/claims`, {
            consumerId: v.consumerId,
            paidAt: v.paidAt,
            forMonth: v.forMonth,
            amount: paise,
            method: v.method,
            refNote: v.refNote.trim() || null,
          });
          rememberMethod(ws.slug, v.method);
          toast.success(
            forSelf
              ? `Claimed ${money(paise)}. It shows as pending until it is confirmed.`
              : `Recorded ${money(paise)} from ${ws.nameOf(v.consumerId)}. It is pending until it is confirmed.`,
          );
          onOpenChange(false);
          onDone();
        }}
      >
        {forSelf ? null : (
          <FormField name="consumerId" label="Who paid" required>
            {(f) => (
              <NativeSelect className="w-full" {...f}>
                {consumers.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField
          name="amount"
          label="Amount"
          required
          description="Like 450 or 450.50. Rupees, no sign needed."
        >
          {(f) => <MoneyInput {...f} />}
        </FormField>
        <FormField name="forMonth" label="For the month" required>
          {(f) => (
            <NativeSelect className="w-full" {...f}>
              {months.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {monthLong(m)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField name="method" label="Paid by" required>
          {(f) => (
            <ToggleGroup
              id={f.id}
              aria-label="Paid by"
              variant="outline"
              className="flex-wrap"
              value={[f.value]}
              onValueChange={(next) => {
                const picked = next[0];
                if (picked) f.onChange(picked);
              }}
            >
              {PAY_METHODS.map((m) => (
                <ToggleGroupItem key={m} value={m}>
                  {m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </FormField>
        <FormField name="paidAt" label="Paid on" required>
          {(f) => (
            <DateField
              id={f.id}
              aria-invalid={f["aria-invalid"]}
              aria-describedby={f["aria-describedby"]}
              value={f.value}
              onChange={f.onChange}
              onBlur={f.onBlur}
              max={today}
              today={today}
              label="Day it was paid"
            />
          )}
        </FormField>
        <FormField
          name="refNote"
          label="Reference (optional)"
          description={`A UPI reference, or a note to remember it by. ${note.length}/${REF_MAX}`}
        >
          {(f) => <Input {...f} maxLength={REF_MAX} autoComplete="off" />}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}
