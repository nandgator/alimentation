import {
  addDays,
  addMonths,
  type IsoDate,
  type Issue,
  type LogEntryDto,
  logChoices,
  type MenuVersion,
  monthStart,
} from "@alimentation/core";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { z } from "zod";
import { ApiFailure, api, getJson, postJson } from "@/api";
import { CountInput, DateField, FormDialog, FormField, toast, useAppForm } from "@/components/app";
import { AppForm } from "@/components/app/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  beforeMenuWords,
  itemName,
  menuIn,
  menuStartsAfter,
  serviceName,
} from "../../../catalogue.ts";
import {
  bodiesFor,
  INTENT_ACTION,
  type Intent,
  intentOptions,
  type LogBody,
  type LogFormValues,
  unionChoices,
  WHOLE_DAY,
} from "../../../logForm.ts";
import { useWorkspace } from "../context.tsx";
import { dayChips, relativeDay } from "../today/days.ts";
import { useFetch } from "../today/useFetch.ts";

export const INTENT_COPY: Record<
  Intent,
  {
    title: string;
    /** What the button that opens it says. */
    action: string;
    submit: string;
    busy: string;
  }
> = {
  skip: { title: "Skip a meal", action: "Skip a meal", submit: "Skip", busy: "Skipping…" },
  extra: { title: "Add an extra", action: "Add an extra", submit: "Add", busy: "Adding…" },
  switch: { title: "Change a meal", action: "Change a meal", submit: "Change", busy: "Changing…" },
  off: {
    title: "Kitchen off",
    action: "Mark the kitchen off",
    submit: "Mark the kitchen off",
    busy: "Saving…",
  },
};

/** The intent a logged entry came from, so Edit opens the right form. */
export const intentOfEntry = (e: Pick<LogEntryDto, "action">): Intent =>
  e.action === "Leave"
    ? "skip"
    : e.action === "Extra"
      ? "extra"
      : e.action === "Switch"
        ? "switch"
        : "off";

export interface LogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: Intent;
  /** What to start with, for a form opened from a person's row or a meal. */
  defaults?: { personId?: string; date?: string; serviceIds?: string[] };
  /** An entry to change: it is removed and the new one added, and if the new one is refused the old one is put back. */
  editing?: LogEntryDto;
  /** Called after the log has changed, so the screen that opened the dialog can fetch it again. */
  onLogged?: () => void;
}

type Field = "personId" | "date" | "scope" | "serviceId" | "itemId" | "qty";

/** Which field a refusal is about, so it lands under that field and not in a banner far away (FRM-02). */
function fieldOf(code: string): Field {
  if (code.startsWith("QTY")) return "qty";
  if (code.startsWith("ITEM")) return "itemId";
  if (code === "NOT_ENROLLED" || code === "SERVICE_NOT_SERVED" || code === "UNKNOWN_SERVICE")
    return "scope";
  if (code === "UNKNOWN_PERSON" || code === "NOT_A_CONSUMER" || code === "FOR_SELF_ONLY")
    return "personId";
  return "date";
}

/** The first working day from `from`, so a form opens on a day that can be logged. */
export function nextWorkingDay(from: IsoDate, workingDays: readonly number[]): IsoDate {
  let d = from;
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (workingDays.includes(wd)) return d;
  }
  return from;
}

const asBody = (e: LogEntryDto): LogBody => ({
  date: e.date,
  personId: e.personId,
  allConsumers: e.allConsumers,
  action: e.action,
  serviceId: e.serviceId,
  itemId: e.itemId,
  qty: e.qty,
  note: e.note,
});

/**
 * One form for logging a skip, an extra, a change of meal, or a day the kitchen is off (FRM-16). It opens with only
 * what the intent needs: who (for an admin), which day as chips, and which meal. A note sits under "More details".
 * What can be chosen comes from the legal choices for that person and day, so nothing is offered that the server
 * would refuse for its shape; what the rules refuse (a day already logged, a closed month) is checked as the person
 * chooses and shown under the field it is about.
 */
export function LogDialog({
  open,
  onOpenChange,
  intent,
  defaults,
  editing,
  onLogged,
}: LogDialogProps) {
  const ws = useWorkspace();
  const { boot } = ws;
  const formId = useId();
  const mayPick = ws.role !== "consumer" && intent !== "off";
  const consumers = useMemo(
    () => boot.people.filter((p) => p.role === "consumer" && p.status === "ACTIVE"),
    [boot.people],
  );
  const today = boot.today as IsoDate;
  const copy = INTENT_COPY[intent];

  const menus = useFetch("menus", () => getJson<MenuVersion[]>(`${ws.api}/menus`), open);
  const known = menus.data ?? (boot.menu ? [boot.menu] : []);

  const initial = useMemo((): LogFormValues => {
    const first = nextWorkingDay(
      ws.role === "consumer" && intent !== "off" ? addDays(today, 1) : today,
      boot.policy.workingDays,
    );
    return {
      personId: editing?.personId ?? defaults?.personId ?? (mayPick ? "" : boot.me.personId),
      date: editing?.date ?? defaults?.date ?? first,
      scope: editing
        ? [editing.serviceId ?? WHOLE_DAY]
        : (defaults?.serviceIds ?? []).slice(0, intent === "skip" || intent === "off" ? 9 : 1),
      serviceId: editing?.serviceId ?? defaults?.serviceIds?.[0] ?? "",
      itemId: editing?.itemId ?? "",
      qty: String(editing?.qty ?? 1),
      note: editing?.note ?? "",
    };
  }, [
    editing,
    defaults,
    mayPick,
    intent,
    today,
    ws.role,
    boot.me.personId,
    boot.policy.workingDays,
  ]);

  // What the current choices need, read by the schema at submit time.
  const need = useRef({ mayPick, intent, services: [] as string[], max: null as number | null });
  const schema = useMemo(
    () =>
      z
        .object({
          personId: z.string(),
          date: z.string().min(1, "Choose a day."),
          scope: z.array(z.string()),
          serviceId: z.string(),
          itemId: z.string(),
          qty: z.string(),
          note: z.string().max(500, "Keep the note under 500 characters."),
        })
        .superRefine((v, ctx) => {
          const n = need.current;
          const bad = (path: Field, message: string) =>
            ctx.addIssue({ code: "custom", path: [path], message });
          if (n.mayPick && !v.personId) bad("personId", "Choose who it is for.");
          if (
            (n.intent === "skip" || n.intent === "off") &&
            n.services.length > 0 &&
            v.scope.length === 0
          )
            bad("scope", "Choose which meal, or the whole day.");
          if (n.intent === "extra" || n.intent === "switch") {
            if (!v.serviceId) bad("serviceId", "Choose which meal it is for.");
            if (!v.itemId) bad("itemId", "Choose an item.");
          }
          if (n.intent === "extra") {
            const q = Number(v.qty);
            const max = n.max ?? 99;
            if (!Number.isInteger(q) || q < 1 || q > max)
              bad("qty", `Enter how many, from 1 to ${max}.`);
          }
        }),
    [],
  );
  const form = useAppForm(schema, initial);
  const values = form.watch();
  const { personId, date, scope, serviceId, itemId, qty } = values;

  const forPerson = mayPick ? personId : boot.me.personId;
  const person = boot.people.find((p) => p.id === forPerson);
  const menu = menuIn(known, date as IsoDate);
  const menuStart = menuStartsAfter(known, date as IsoDate);
  const choices = useMemo(
    () =>
      intent === "off"
        ? unionChoices(
            consumers.map((p) =>
              logChoices(menu, boot.catalogue, boot.services, p, date as IsoDate, boot.enrolments),
            ),
          )
        : person
          ? logChoices(
              menu,
              boot.catalogue,
              boot.services,
              person,
              date as IsoDate,
              boot.enrolments,
            )
          : [],
    [intent, menu, boot.catalogue, boot.services, boot.enrolments, consumers, person, date],
  );
  const options = useMemo(() => intentOptions(choices, intent), [choices, intent]);
  const max = options.items[serviceId]?.find((i) => i.itemId === itemId)?.maxQty ?? null;
  need.current = { mayPick, intent, services: options.services, max };
  const waitingForPerson = mayPick && !personId;
  const nothing = !waitingForPerson && options.none && !menuStart;

  // Keep the choices legal as the person and the day change: drop a meal that is no longer served, and start an
  // extra or a change on the first item of its meal, so the common case is one tap fewer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when what is on offer changes
  useEffect(() => {
    if (!open) return;
    const keep = { shouldDirty: false, shouldValidate: false } as const;
    if (intent === "skip" || intent === "off") {
      const legal = scope.filter((s) => s === WHOLE_DAY || options.services.includes(s));
      if (options.services.length > 0 && legal.length !== scope.length)
        form.setValue("scope", legal, keep);
      return;
    }
    // Nothing on offer yet (the menus are still arriving, or no one is chosen): leave what was given alone.
    if (options.none) return;
    const offered = Object.keys(options.items);
    const sv = options.items[serviceId]
      ? serviceId
      : offered.length === 1
        ? (offered[0] ?? "")
        : "";
    if (sv !== serviceId) form.setValue("serviceId", sv, keep);
    const items = options.items[sv] ?? [];
    if (!items.some((i) => i.itemId === itemId))
      form.setValue("itemId", items[0]?.itemId ?? "", keep);
  }, [open, options, intent, serviceId, itemId]);

  const bodies = useMemo(() => {
    if (!date || (mayPick && !personId) || nothing || options.none) return [];
    if (
      (intent === "skip" || intent === "off") &&
      options.services.length > 0 &&
      scope.length === 0
    )
      return [];
    if ((intent === "extra" || intent === "switch") && (!serviceId || !itemId)) return [];
    const v = { personId: forPerson, date, scope, serviceId, itemId, qty, note: "" };
    return bodiesFor(intent, v, options);
  }, [date, mayPick, personId, nothing, options, intent, scope, serviceId, itemId, qty, forPerson]);

  // Tell the person what is wrong before they press the button: the rules are the server's own, asked as they choose.
  const [issues, setIssues] = useIssues(open, ws.api, bodies, !!editing);
  const placed = useRef(new Set<Field>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `form` is stable
  useEffect(() => {
    const now = new Set<Field>();
    for (const i of issues) {
      if (i.severity !== "error") continue;
      const f = fieldOf(i.code);
      if (now.has(f)) continue;
      now.add(f);
      form.setError(f, { type: "server", message: i.message });
    }
    for (const f of placed.current)
      if (!now.has(f) && form.getFieldState(f).error?.type === "server") form.clearErrors(f);
    placed.current = now;
  }, [issues]);
  const warnings = issues.filter((i) => i.severity === "warning");
  const blocked = issues.some((i) => i.severity === "error") || nothing || !!menuStart;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh form each time it opens
  useEffect(() => {
    if (open) {
      form.reset(initial);
      setIssues([]);
    }
  }, [open]);

  const send = async (v: LogFormValues) => {
    const list = bodiesFor(intent, v, options);
    const made: string[] = [];
    const old = editing ? asBody(editing) : null;
    const undo = async () => {
      for (const id of made) await api.del(`${ws.api}/log/${id}`);
      if (old) await postJson(`${ws.api}/log`, old);
      onLogged?.();
      ws.reload();
    };
    try {
      if (editing) await api.del(`${ws.api}/log/${editing.id}`);
      for (const b of list) made.push((await postJson<{ id: string }>(`${ws.api}/log`, b)).id);
    } catch (e) {
      for (const id of made) await api.del(`${ws.api}/log/${id}`).catch(() => undefined);
      if (old) await postJson(`${ws.api}/log`, old).catch(() => undefined);
      if (e instanceof ApiFailure && e.issues.length > 0) {
        const first = e.issues[0] as unknown as Issue;
        form.setError(
          fieldOf(first.code ?? ""),
          { type: "server", message: e.message },
          { shouldFocus: true },
        );
        return;
      }
      throw e;
    }
    onOpenChange(false);
    onLogged?.();
    ws.reload();
    const when = relativeDay(v.date, today);
    const day = when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`;
    const meals = (
      v.scope.includes(WHOLE_DAY) || options.services.length === 0
        ? ["the whole day"]
        : options.services.filter((s) => v.scope.includes(s)).map((s) => serviceName(boot, s))
    ).join(" and ");
    const who = ws.role !== "consumer" && intent !== "off" ? `${ws.nameOf(v.personId)}: ` : "";
    const message = editing
      ? "Entry changed."
      : intent === "skip"
        ? `${who}${meals} skipped ${day}.`
        : intent === "extra"
          ? `${who}${v.qty} ${itemName(boot, v.itemId)} added ${day}.`
          : intent === "switch"
            ? `${who}Changed to ${itemName(boot, v.itemId)} ${day}.`
            : `Kitchen off ${day}.`;
    toast.undo(message, undo);
  };

  const needsMeal = intent === "extra" || intent === "switch";
  const mealsOffered = needsMeal ? Object.keys(options.items) : options.services;
  const chips = dayChips(today, 8);
  const lastDay = addDays(today, 120);
  const firstDay = monthStart(addMonths(boot.currentMonth, -1));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Change: ${copy.title.toLowerCase()}` : copy.title}
      description={
        mayPick
          ? "Choose who, the day and the meal."
          : intent === "off"
            ? "No one is served on the meals you choose. It applies to everyone."
            : "Choose the day and the meal."
      }
      formId={formId}
      submitLabel={editing ? "Save" : copy.submit}
      busyLabel={editing ? "Saving…" : copy.busy}
      submitting={form.formState.isSubmitting}
      submitDisabled={blocked || !ws.writable}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset(initial)}
    >
      <AppForm id={formId} form={form} onSubmit={send}>
        {mayPick ? (
          <FormField name="personId" label="Who is it for?">
            {(f) => (
              <NativeSelect {...f} onChange={(e) => f.onChange(e.target.value)} className="w-full">
                <NativeSelectOption value="">Choose a person</NativeSelectOption>
                {consumers.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}

        <FormField name="date" label="Which day?">
          {(f) => (
            <div className="flex flex-col gap-2">
              <div role="group" aria-label="Days" className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <Button
                    key={c.iso}
                    type="button"
                    variant={f.value === c.iso ? "default" : "outline"}
                    aria-pressed={f.value === c.iso}
                    onClick={() => f.onChange(c.iso)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              <DateField
                id={f.id}
                aria-invalid={f["aria-invalid"]}
                aria-describedby={f["aria-describedby"]}
                value={f.value}
                onChange={f.onChange}
                onBlur={f.onBlur}
                min={firstDay}
                max={lastDay}
                today={today}
                presets={false}
                label="Choose another day"
                placeholder="Another day"
              />
            </div>
          )}
        </FormField>

        {menuStart ? (
          <Alert>
            <AlertDescription>{beforeMenuWords(menuStart)}</AlertDescription>
          </Alert>
        ) : nothing ? (
          <Alert>
            <AlertDescription>
              {intent === "off"
                ? "The menu does not serve anyone on this day."
                : `Nothing can be logged for ${person?.id === boot.me.personId ? "you" : (person?.name ?? "this person")} on this day: not eating, or the menu does not serve it.`}
            </AlertDescription>
          </Alert>
        ) : null}

        {(intent === "skip" || intent === "off") && options.services.length > 0 ? (
          <FormField name="scope" label="Which meals?">
            {(f) => (
              <ToggleGroup
                multiple
                variant="outline"
                aria-label="Meals"
                className="flex-wrap"
                value={f.value as string[]}
                onValueChange={(next: string[]) => {
                  const had = (f.value as string[]).includes(WHOLE_DAY);
                  f.onChange(
                    next.includes(WHOLE_DAY) && !had
                      ? [WHOLE_DAY]
                      : next.filter((s) => s !== WHOLE_DAY),
                  );
                }}
              >
                {options.wholeDay ? (
                  <ToggleGroupItem value={WHOLE_DAY}>Whole day</ToggleGroupItem>
                ) : null}
                {options.services.map((s) => (
                  <ToggleGroupItem key={s} value={s}>
                    {serviceName(boot, s)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </FormField>
        ) : null}

        {needsMeal && mealsOffered.length > 1 ? (
          <FormField name="serviceId" label="Which meal?">
            {(f) => (
              <ToggleGroup
                variant="outline"
                aria-label="Meal"
                className="flex-wrap"
                value={f.value ? [f.value as string] : []}
                onValueChange={(next: string[]) => f.onChange(next[0] ?? f.value)}
              >
                {mealsOffered.map((s) => (
                  <ToggleGroupItem key={s} value={s}>
                    {serviceName(boot, s)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </FormField>
        ) : null}

        {needsMeal && (options.items[serviceId]?.length ?? 0) > 0 ? (
          <FormField name="itemId" label={intent === "switch" ? "Change to" : "What do you want?"}>
            {(f) => (
              <NativeSelect {...f} onChange={(e) => f.onChange(e.target.value)} className="w-full">
                {options.items[serviceId]?.map((i) => (
                  <NativeSelectOption key={i.itemId} value={i.itemId}>
                    {itemName(boot, i.itemId)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}

        {intent === "extra" ? (
          <FormField name="qty" label="How many?" description={max ? `Up to ${max}.` : undefined}>
            {(f) => <CountInput {...f} className="w-28" />}
          </FormField>
        ) : null}

        {warnings.map((w) => (
          <Alert key={w.code}>
            <AlertDescription>{w.message}</AlertDescription>
          </Alert>
        ))}

        <Collapsible>
          <CollapsibleTrigger
            render={<Button type="button" variant="ghost" size="sm" className="-ml-2 group/more" />}
          >
            More details
            <ChevronDownIcon
              aria-hidden="true"
              className="transition-transform group-aria-expanded/more:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-2">
              <FormField name="note" label="Note (optional)">
                {(f) => <Input {...f} maxLength={500} autoComplete="off" />}
              </FormField>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </AppForm>
    </FormDialog>
  );
}

import { type Dispatch, type SetStateAction, useState } from "react";

/**
 * The rules' verdict on what is about to be sent, asked 300ms after the person stops choosing. An entry that
 * is being changed is not checked against its own earlier self.
 */
function useIssues(
  open: boolean,
  apiBase: string,
  bodies: LogBody[],
  editing: boolean,
): [Issue[], Dispatch<SetStateAction<Issue[]>>] {
  const [issues, setIssues] = useState<Issue[]>([]);
  const key = JSON.stringify(bodies);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `bodies`
  useEffect(() => {
    if (!open) return;
    if (bodies.length === 0) {
      setIssues([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const all = await Promise.all(
        bodies.map((b) =>
          postJson<{ issues: Issue[] }>(`${apiBase}/log/check`, b).then(
            (r) => r.issues,
            () => [] as Issue[],
          ),
        ),
      );
      if (!live) return;
      const seen = new Set<string>();
      setIssues(
        all.flat().filter((i) => {
          if (editing && (i.code === "DUPLICATE" || i.code === "OVERLAPPING_SCOPE")) return false;
          const k = `${i.code}|${i.message}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, apiBase, key, editing]);
  return [issues, setIssues];
}

export { INTENT_ACTION };
