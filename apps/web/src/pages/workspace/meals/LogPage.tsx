import { addMonths, type LogEntryDto, monthEnd, monthStart } from "@alimentation/core";
import {
  CalendarOffIcon,
  ClockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { api, getJson, postJson } from "@/api";
import { EmptyState, PageHeader, PageSkeleton, StatusBadge, toast } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useUrlState } from "@/hooks";
import { type Intent, intentsFor, type LogBody } from "../../../logForm.ts";
import { useWorkspace } from "../context.tsx";
import { fullDay, relativeDay } from "../today/days.ts";
import { LoadError } from "../today/LoadError.tsx";
import { useFetch } from "../today/useFetch.ts";
import { byDay, entryTitle, lateWords } from "./entries.ts";
import { INTENT_COPY, intentOfEntry, LogDialog } from "./LogDialog.tsx";
import { intentIcon } from "./LogMenu.tsx";

const bodyOf = (e: LogEntryDto): LogBody => ({
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
 * Meals: what has been logged, and the ways to log more (FRM-16). The intents come first, as buttons in a person's
 * own words (skip a meal, add an extra, change a meal); each opens a short form. Under them the entries, a day at a
 * time, each with a menu to change or remove it. A removal acts at once and offers Undo.
 */
export function LogPage() {
  const ws = useWorkspace();
  const { boot } = ws;
  const mine = ws.role === "consumer";
  const intents = intentsFor(ws.role);
  const [who, setWho] = useUrlState("who", "");
  const [dialog, setDialog] = useState<Intent | null>(null);
  const [editing, setEditing] = useState<LogEntryDto | null>(null);

  const from = monthStart(addMonths(boot.currentMonth, -1));
  const to = monthEnd(addMonths(boot.currentMonth, 1));
  const list = useFetch(`log:${from}:${to}`, () =>
    getJson<LogEntryDto[]>(`${ws.api}/log?from=${from}&to=${to}`),
  );
  const { mutate, reload } = list;
  const consumers = boot.people.filter((p) => p.role === "consumer");

  const shown = (list.data ?? []).filter((e) => !who || e.allConsumers || e.personId === who);
  const days = byDay(shown, ws.nameOf);
  const may = (e: LogEntryDto) => ws.writable && (ws.role === "admin" || e.by === "You");

  const remove = async (e: LogEntryDto) => {
    mutate((l) => l.filter((x) => x.id !== e.id));
    try {
      await api.del(`${ws.api}/log/${e.id}`);
      ws.reload();
      toast.undo("Entry removed.", () => {
        postJson(`${ws.api}/log`, bodyOf(e)).then(
          () => {
            reload();
            ws.reload();
          },
          (err: Error) => toast.error(err.message),
        );
      });
    } catch (err) {
      mutate((l) => [...l, e]);
      toast.error(err instanceof Error ? err.message : "That did not work. Try again.");
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title={mine ? "My meals" : "Meals"}
        description={
          mine
            ? "Skip a meal, add an extra or change what you eat. What you have logged is below."
            : "What has been logged for the kitchen's people, and the days the kitchen is off."
        }
      />

      {intents.length > 0 ? (
        <div className="mb-6 grid gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Log">
          {intents.map((i, n) => {
            const Icon = intentIcon(i);
            return (
              <Button
                key={i}
                variant={n === 0 ? "default" : "outline"}
                disabled={!ws.writable}
                onClick={() => setDialog(i)}
              >
                <Icon aria-hidden="true" data-icon="inline-start" />
                {INTENT_COPY[i].action}
              </Button>
            );
          })}
        </div>
      ) : null}

      {!mine && (list.data?.length ?? 0) > 0 ? (
        <div className="mb-4">
          <NativeSelect aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
            <NativeSelectOption value="">Everyone</NativeSelectOption>
            {consumers.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {list.error ? (
        <div className="mb-4">
          <LoadError error={list.error} what="the entries" onRetry={list.reload} />
        </div>
      ) : null}

      <PageSkeleton loading={!list.data && !list.error} variant="list">
        {list.data && days.length === 0 ? (
          <EmptyState
            icon={CalendarOffIcon}
            title={who ? "Nothing logged for this person" : "Nothing logged yet"}
            description={
              mine
                ? "When you skip a meal or add an extra it will show here."
                : "Skips, extras and days the kitchen is off will show here."
            }
          />
        ) : null}
        {days.map((d) => (
          <section key={d.date} aria-labelledby={`day-${d.date}`} className="mb-4">
            <h2
              id={`day-${d.date}`}
              className="sticky top-14 z-10 flex items-baseline gap-2 bg-background py-2 text-sm font-semibold"
            >
              {relativeDay(d.date, boot.today)}
              <span className="font-normal text-muted-foreground">{fullDay(d.date)}</span>
            </h2>
            <ul className="divide-y rounded-xl border bg-card">
              {d.entries.map((e) => {
                const title = entryTitle(boot, e);
                const late = lateWords(e.lateByDays);
                const Icon = intentIcon(intentOfEntry(e));
                const forWhom = e.allConsumers
                  ? "Everyone"
                  : e.personId
                    ? ws.nameOf(e.personId)
                    : "";
                const detail = [
                  !mine ? forWhom : null,
                  e.by !== "You" && mine ? `Added by ${e.by}` : null,
                  e.note,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={e.id} className="flex items-center gap-3 p-3">
                    <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{title}</p>
                      {detail ? (
                        <p className="truncate text-sm text-muted-foreground">{detail}</p>
                      ) : null}
                      {late || e.date > boot.today ? (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5">
                          {late ? (
                            <Badge variant="outline" className="text-warning-foreground">
                              <ClockIcon aria-hidden="true" data-icon="inline-start" />
                              {late}
                            </Badge>
                          ) : null}
                          {e.date > boot.today ? (
                            <StatusBadge status="projected" label="Upcoming" />
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    {may(e) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${title}${forWhom ? `, ${forWhom}` : ""}, ${fullDay(e.date)}`}
                            />
                          }
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem
                            className="min-h-11 pointer-fine:min-h-8"
                            onClick={() => setEditing(e)}
                          >
                            <PencilIcon aria-hidden="true" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11 pointer-fine:min-h-8"
                            variant="destructive"
                            onClick={() => void remove(e)}
                          >
                            <TrashIcon aria-hidden="true" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </PageSkeleton>

      {dialog ? (
        <LogDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          intent={dialog}
          onLogged={reload}
        />
      ) : null}
      {editing ? (
        <LogDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          intent={intentOfEntry(editing)}
          editing={editing}
          onLogged={reload}
        />
      ) : null}
    </div>
  );
}
