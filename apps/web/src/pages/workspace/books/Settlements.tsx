import { SETTLEMENT_TYPES, type SettlementDto } from "@alimentation/core";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { getJson, postJson } from "@/api";
import {
  AppForm,
  type DataColumn,
  DataTable,
  EmptyState,
  FormDialog,
  FormField,
  Money,
  MoneyInput,
  PageHeader,
  PageSkeleton,
  toast,
  useAppForm,
} from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { date, money, month as monthLabel, toPaise } from "@/format";
import { useWorkspace } from "../context.tsx";
import { LoadProblem, useLoad } from "./parts.tsx";

const schema = z
  .object({
    consumerId: z.string().min(1, "Choose who it is for"),
    forMonth: z.string().min(1, "Choose the month"),
    type: z.enum(SETTLEMENT_TYPES),
    amount: z.string(),
    note: z.string().max(500, "Keep the note under 500 characters"),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "Query" && toPaise(v.amount) === null)
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter the amount in rupees, like 3200 or 12.50",
      });
  });

const TYPE_HELP: Record<(typeof SETTLEMENT_TYPES)[number], string> = {
  Payment: "A payment taken outside the app.",
  Query: "A payment you are questioning. It has no amount.",
  "Query Resolved": "Closes a query, with the amount that was agreed.",
};

/** Record a settlement: one entry, added and never changed. */
function RecordSettlement({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const consumers = ws.boot.people.filter((p) => p.role === "consumer");
  const form = useAppForm(schema, {
    consumerId: consumers[0]?.id ?? "",
    forMonth: ws.boot.currentMonth as string,
    type: "Payment" as (typeof SETTLEMENT_TYPES)[number],
    amount: "",
    note: "",
  });
  const type = form.watch("type");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a settlement"
      description="Payments taken outside the app, queries raised and queries resolved. They are added, never changed."
      formId="settlement-form"
      submitLabel="Record"
      busyLabel="Recording…"
      submitting={form.formState.isSubmitting}
      submitDisabled={!ws.writable}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
    >
      <AppForm
        id="settlement-form"
        form={form}
        onSubmit={async (v) => {
          await postJson(`${ws.api}/settlements`, {
            consumerId: v.consumerId,
            forMonth: v.forMonth,
            type: v.type,
            amount: v.type === "Query" ? null : toPaise(v.amount),
            note: v.note.trim() || null,
          });
          toast.success("Settlement recorded.");
          form.reset();
          onOpenChange(false);
          onDone();
          ws.reload();
        }}
      >
        <FormField name="consumerId" label="Who" required>
          {(f) => (
            <NativeSelect {...f} className="w-full">
              {consumers.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField name="forMonth" label="Month" required>
          {(f) => (
            <NativeSelect {...f} className="w-full">
              {[...ws.boot.months].reverse().map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {monthLabel(m)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField name="type" label="Type" description={TYPE_HELP[type]} required>
          {(f) => (
            <NativeSelect {...f} className="w-full">
              {SETTLEMENT_TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {t}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {type !== "Query" ? (
          <FormField name="amount" label="Amount" required>
            {(f) => <MoneyInput {...f} />}
          </FormField>
        ) : null}
        <FormField name="note" label="Note (optional)">
          {(f) => <Input {...f} maxLength={500} autoComplete="off" />}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}

export function Settlements() {
  const ws = useWorkspace();
  const list = useLoad(() => getJson<SettlementDto[]>(`${ws.api}/settlements`), [ws.api]);
  const [open, setOpen] = useState(false);
  const hasConsumers = ws.boot.people.some((p) => p.role === "consumer");
  const record = (
    <Button type="button" disabled={!ws.writable || !hasConsumers} onClick={() => setOpen(true)}>
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      Record a settlement
    </Button>
  );
  const columns: DataColumn<SettlementDto>[] = [
    {
      id: "date",
      header: "Date",
      cell: (s) => date(s.date),
      sort: (s) => s.date,
    },
    {
      id: "who",
      header: "Who",
      cell: (s) => <span className="font-medium">{ws.nameOf(s.consumerId)}</span>,
      sort: (s) => ws.nameOf(s.consumerId),
      search: (s) => ws.nameOf(s.consumerId),
    },
    {
      id: "month",
      header: "Month",
      cell: (s) => monthLabel(s.forMonth),
      sort: (s) => s.forMonth,
      facet: { label: "Month", value: (s) => monthLabel(s.forMonth) },
    },
    {
      id: "type",
      header: "Type",
      cell: (s) => s.type,
      facet: { label: "Type", value: (s) => s.type },
    },
    {
      id: "amount",
      header: "Amount",
      align: "end",
      cell: (s) => (s.amount === null ? null : <Money paise={s.amount} fraction />),
      sort: (s) => s.amount,
    },
    {
      id: "note",
      header: "Note",
      cell: (s) => s.note ?? "",
      search: (s) => s.note,
      className: "max-w-64 whitespace-normal",
    },
  ];
  return (
    <>
      <PageHeader
        title="Settlements"
        description="An admin’s own entries: payments taken outside the app, queries raised, queries resolved. They are added, never changed."
        actions={record}
      />
      <LoadProblem error={list.error} onRetry={list.reload} />
      <PageSkeleton loading={list.loading && !list.data} variant="table">
        <DataTable<SettlementDto>
          data={list.data ?? []}
          columns={columns}
          getRowId={(s) => s.id}
          caption="Settlements"
          searchLabel="Search settlements"
          initialSort={{ id: "date", desc: true }}
          empty={
            <EmptyState
              title="No settlements yet"
              description="Payments taken outside the app and queries raised about a payment are recorded here."
              action={record}
            />
          }
          mobile={{
            title: (s) => ws.nameOf(s.consumerId),
            description: (s) =>
              `${s.type} · ${monthLabel(s.forMonth)} · ${date(s.date)}${s.note ? ` · ${s.note}` : ""}`,
            trailing: (s) => (s.amount === null ? null : money(s.amount)),
          }}
        />
      </PageSkeleton>
      <RecordSettlement open={open} onOpenChange={setOpen} onDone={list.reload} />
    </>
  );
}
