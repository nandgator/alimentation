import type { ClaimDto } from "@alimentation/core";
import { useEffect } from "react";
import { z } from "zod";
import { postJson } from "@/api";
import { AppForm, FormDialog, FormField, toast, useAppForm } from "@/components/app";
import { Textarea } from "@/components/ui/textarea";
import { money, monthLong } from "@/format";
import { useWorkspace } from "../context.tsx";

export type DecideMode = "dispute" | "reverse";

const schema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason. It is recorded in the audit trail.")
    .max(500, "Keep it to 500 characters."),
});

/**
 * Dispute (the cook says a claim is wrong) and Reverse (the admin takes a decision back). Both need a reason, which
 * is marked Required, and both say what changes in the books (FRM-11). The button stays enabled: a missing reason is
 * answered under the field on submit, not by a button that will not press.
 */
export function DecideDialog({
  claim,
  mode,
  onClose,
  onDone,
}: {
  claim: ClaimDto | null;
  mode: DecideMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const form = useAppForm(schema, { reason: "" });
  const id = claim?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new claim starts a clean form
  useEffect(() => {
    form.reset({ reason: "" });
  }, [id, mode]);

  const who = claim ? ws.nameOf(claim.consumerId) : "";
  const what = claim
    ? `${who}'s ${monthLong(claim.forMonth)} payment of ${money(claim.amount)}`
    : "";
  const dispute = mode === "dispute";

  return (
    <FormDialog
      open={claim !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={dispute ? "Dispute this payment" : "Reverse this decision"}
      description={
        dispute
          ? `${what} goes to Disputed and does not count toward the bill.`
          : `${what} stops counting toward the bill. It stays on record as Reversed.`
      }
      formId="decide-form"
      submitLabel={dispute ? "Dispute" : "Reverse"}
      busyLabel={dispute ? "Disputing…" : "Reversing…"}
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset({ reason: "" })}
    >
      <AppForm
        id="decide-form"
        form={form}
        serverFields={{ REASON_REQUIRED: "reason" }}
        onSubmit={async ({ reason }) => {
          if (!claim) return;
          if (dispute)
            await postJson(`${ws.api}/claims/${claim.id}/decision`, {
              decision: "Disputed",
              note: reason,
            });
          else await postJson(`${ws.api}/claims/${claim.id}/reversal`, { reason });
          toast.success(dispute ? `Disputed ${what}.` : `Reversed ${what}.`);
          onDone();
          onClose();
        }}
      >
        <FormField
          name="reason"
          label={dispute ? "Why is it disputed? (required)" : "Why is it reversed? (required)"}
          description="Recorded in the audit trail."
        >
          {(f) => (
            <>
              <Textarea {...f} maxLength={500} rows={3} />
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                {String(f.value ?? "").length} of 500
              </p>
            </>
          )}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}
