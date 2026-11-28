import {
  addDays,
  type IsoDate,
  isValidDate,
  type LogEntryDto,
  logChoices,
  type MenuVersion,
} from "@alimentation/core";
import {
  CalendarOffIcon,
  CheckCircle2Icon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { api, getJson, postJson } from "@/api";
import { DateField, EmptyState, PageHeader, PageSkeleton, toast } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUrlState } from "@/hooks";
import { itemName, menuIn, serviceName, severalServices } from "../../../catalogue.ts";
import { type Intent, intentsFor, type LogBody } from "../../../logForm.ts";
import { useWorkspace } from "../context.tsx";
import { LogDialog } from "../meals/LogDialog.tsx";
import { LogMenu } from "../meals/LogMenu.tsx";
import { longDay, relativeDay } from "./days.ts";
import { LoadError } from "./LoadError.tsx";
import { buildRoll, type DayState, headcount, type RollRow, type RollService } from "./roll.ts";
import { useFetch } from "./useFetch.ts";

const LATER = 800;

/** A change that was refused moves its chip 2px and back, over 150ms, unless the person asks for no motion. */
function shake(el: HTMLElement | undefined) {
  if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  el.animate(
    [{ translate: "0" }, { translate: "-2px" }, { translate: "2px" }, { translate: "0" }],
    { duration: 150 },
  );
}

const wordsFor = (d: Exclude<DayState, { open: true }>, day: string) =>
  d.why === "weekend"
    ? {
        title: "Not a working day",
        description: `Meals are not served on ${day.split(",")[0]}s. The working days are set under Rules.`,
      }
    : d.why === "holiday"
      ? { title: `Holiday: ${d.name}`, description: "No meals are served today." }
      : {
          title: "There is no menu for this day",
          description: "Set what the kitchen serves, and on which days, under Menu.",
        };

/**
 * Today: who eats which meal on a day (the cook's home, and the admin's day sheet). A day, then a tab for each
 * meal, and in it the menu, the head count and every person with toggles for eating, leave and extras. An admin's
 * toggle takes effect on screen at once, is sent in the background, offers Undo, and rolls back with a message when
 * the server refuses it. A cook sees the same roll and can mark the kitchen off.
 */
export function Daily() {
  const ws = useWorkspace();
  const { boot } = ws;
  const today = boot.today as IsoDate;
  const [dateParam, setDate] = useUrlState("date", today);
  const date = (isValidDate(dateParam) ? dateParam : today) as IsoDate;
  const [mealParam, setMeal] = useUrlState("meal", "");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{
    intent: Intent;
    defaults?: { personId?: string; date?: string; serviceIds?: string[] };
  } | null>(null);

  const menus = useFetch("menus", () => getJson<MenuVersion[]>(`${ws.api}/menus`));
  const log = useFetch(`log:${date}`, () =>
    getJson<LogEntryDto[]>(`${ws.api}/log?from=${date}&to=${date}`),
  );
  const known = menus.data ?? (menus.error && boot.menu ? [boot.menu] : null);
  const menu = known ? menuIn(known, date) : null;

  const edits = ws.role === "admin" && ws.writable;
  const intents = intentsFor(ws.role);
  const roll = known && log.data ? buildRoll(boot, menu, log.data, date) : null;
  const several = roll ? roll.services.length > 1 || severalServices(boot, date) : false;

  // One sync of the statements after a burst of toggles, not one for each.
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  const softReload = useCallback(() => {
    clearTimeout(later.current);
    later.current = setTimeout(ws.reload, LATER);
  }, [ws.reload]);
  useEffect(() => () => clearTimeout(later.current), []);

  const chips = useRef(new Map<string, HTMLElement>());
  const busy = useRef(new Set<string>());
  const temp = useRef(0);
  const { mutate, reload } = log;

  const fail = (key: string, e: unknown) => {
    shake(chips.current.get(key));
    toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
  };
  const drop = useCallback(
    async (id: string) => {
      await api.del(`${ws.api}/log/${id}`);
      mutate((l) => l.filter((e) => e.id !== id));
      softReload();
    },
    [ws.api, mutate, softReload],
  );
  const redo = useCallback(
    async (body: LogBody) => {
      await postJson(`${ws.api}/log`, body);
      reload();
      softReload();
    },
    [ws.api, reload, softReload],
  );
  const attempt = (f: () => Promise<void>) => () => {
    void f().catch((e) =>
      toast.error(e instanceof Error ? e.message : "That did not work. Try again."),
    );
  };

  /** Puts one person on leave for one meal, or takes them off it. */
  const setLeave = async (row: RollRow, s: RollService, on: boolean) => {
    const key = `${row.person.id}|${s.service.id}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    const name = row.person.name;
    const where = several ? ` for ${serviceName(boot, s.service.id)}` : "";
    try {
      if (on) {
        const scoped = logChoices(
          menu,
          boot.catalogue,
          boot.services,
          row.person,
          date,
          boot.enrolments,
        ).some((c) => c.action === "Leave" && c.serviceId === s.service.id);
        const body: LogBody = {
          date,
          personId: row.person.id,
          allConsumers: false,
          action: "Leave",
          serviceId: scoped ? s.service.id : null,
          itemId: null,
          qty: null,
          note: null,
        };
        const tmp: LogEntryDto = {
          ...body,
          id: `tmp-${++temp.current}`,
          loggedBy: boot.me.personId,
          loggedAt: new Date().toISOString(),
          by: "You",
          lateByDays: 0,
        };
        mutate((l) => [...l, tmp]);
        try {
          const { id } = await postJson<{ id: string }>(`${ws.api}/log`, body);
          mutate((l) => l.map((e) => (e.id === tmp.id ? { ...e, id } : e)));
          softReload();
          toast.undo(
            `${name} is on leave${where}.`,
            attempt(() => drop(id)),
          );
        } catch (e) {
          mutate((l) => l.filter((x) => x.id !== tmp.id));
          fail(key, e);
        }
      } else if (row.leave) {
        const old = row.leave;
        mutate((l) => l.filter((e) => e.id !== old.id));
        try {
          await api.del(`${ws.api}/log/${old.id}`);
          softReload();
          const whole = old.serviceId === null && several;
          toast.undo(
            whole
              ? `${name} is eating again for the whole day.`
              : `${name} is eating again${where}.`,
            attempt(() =>
              redo({
                date: old.date,
                personId: old.personId,
                allConsumers: false,
                action: "Leave",
                serviceId: old.serviceId,
                itemId: null,
                qty: null,
                note: old.note,
              }),
            ),
          );
        } catch (e) {
          mutate((l) => [...l, old]);
          fail(key, e);
        }
      }
    } finally {
      busy.current.delete(key);
    }
  };

  /** Takes an extra away: every entry behind it, with Undo. */
  const removeExtra = async (row: RollRow, s: RollService, itemId: string) => {
    const x = row.extras.find((e) => e.itemId === itemId);
    if (!x) return;
    const key = `${row.person.id}|${s.service.id}`;
    const ids = new Set(x.entries.map((e) => e.id));
    mutate((l) => l.filter((e) => !ids.has(e.id)));
    try {
      for (const e of x.entries) await api.del(`${ws.api}/log/${e.id}`);
      softReload();
      toast.undo(
        `${x.qty} ${itemName(boot, itemId)} taken off for ${row.person.name}.`,
        attempt(async () => {
          for (const e of x.entries)
            await postJson(`${ws.api}/log`, {
              date: e.date,
              personId: e.personId,
              allConsumers: false,
              action: "Extra",
              serviceId: e.serviceId,
              itemId: e.itemId,
              qty: e.qty,
              note: e.note,
            } satisfies LogBody);
          reload();
          softReload();
        }),
      );
    } catch (e) {
      reload();
      fail(key, e);
    }
  };

  const open = (intent: Intent, defaults?: { personId?: string; serviceIds?: string[] }) =>
    setDialog({ intent, defaults: { date, ...defaults } });

  const q = query.trim().toLowerCase();
  const panel = (s: RollService) => {
    const rows = q ? s.rows.filter((r) => r.person.name.toLowerCase().includes(q)) : s.rows;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            On the menu:{" "}
            <span className="font-medium text-foreground">{itemName(boot, s.mealId)}</span>
          </p>
          <p
            className="flex items-center gap-2 text-lg font-semibold tabular-nums"
            aria-live="polite"
          >
            <UsersIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            {headcount(s)}
          </p>
        </div>
        {s.kitchenOff ? (
          <EmptyState
            icon={CalendarOffIcon}
            title="The kitchen is off for this meal"
            description="No one is served, so no one is counted. The day's entries stay as they are."
          />
        ) : s.rows.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No one takes this meal today"
            description="People are added to a meal under People."
          />
        ) : (
          <>
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search people"
                placeholder="Search people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No one matches “{query}”.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {rows.map((r) => (
                  <PersonRow
                    key={r.person.id}
                    row={r}
                    edits={edits && !s.kitchenOff}
                    meal={itemName(boot, r.mealId)}
                    register={(el) => {
                      const k = `${r.person.id}|${s.service.id}`;
                      if (el) chips.current.set(k, el);
                      else chips.current.delete(k);
                    }}
                    onLeave={(on) => void setLeave(r, s, on)}
                    onExtra={() =>
                      open("extra", { personId: r.person.id, serviceIds: [s.service.id] })
                    }
                    onRemoveExtra={(itemId) => void removeExtra(r, s, itemId)}
                    itemName={(id) => itemName(boot, id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  };

  const current = roll?.services.find((s) => s.service.id === mealParam) ?? roll?.services[0];
  const near = [-1, 0, 1].map((n) => addDays(today, n));
  const action =
    intents.length > 0 ? (
      <LogMenu intents={intents} onPick={(i) => open(i)} disabled={!ws.writable} />
    ) : null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Today"
        description={longDay(date)}
        actions={action ? <div className="hidden lg:block">{action}</div> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup
          variant="outline"
          aria-label="Day"
          value={near.includes(date) ? [date] : []}
          onValueChange={(v: string[]) => v[0] && setDate(v[0])}
        >
          {near.map((d) => (
            <ToggleGroupItem key={d} value={d}>
              {relativeDay(d, today)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DateField
          value={date}
          onChange={(d) => setDate(d)}
          today={today}
          presets={false}
          label="Choose a day"
          className="w-auto"
        />
      </div>

      {log.error ? (
        <div className="mb-4">
          <LoadError error={log.error} what="the roll" onRetry={log.reload} />
        </div>
      ) : null}
      {menus.error && !menus.data ? (
        <div className="mb-4">
          <LoadError error={menus.error} what="the menu" onRetry={menus.reload} />
        </div>
      ) : null}

      <PageSkeleton loading={!roll && !log.error} variant="list">
        {roll ? (
          !roll.day.open ? (
            <EmptyState
              icon={CalendarOffIcon}
              {...wordsFor(roll.day, longDay(date))}
              action={
                roll.day.why === "no-menu" && ws.role === "admin" ? (
                  <Button nativeButton={false} render={<Link href={`${ws.base}/setup/menu`} />}>
                    Set the menu
                  </Button>
                ) : undefined
              }
            />
          ) : roll.services.length === 0 ? (
            <EmptyState
              icon={CalendarOffIcon}
              title="The menu serves nothing on this day"
              description="Set what the kitchen serves, and on which days, under Menu."
            />
          ) : roll.services.length === 1 && current ? (
            panel(current)
          ) : (
            <Tabs value={current?.service.id} onValueChange={(v) => setMeal(String(v))}>
              <TabsList
                variant="line"
                aria-label="Meals"
                className="w-full justify-start overflow-x-auto sm:w-fit"
              >
                {roll.services.map((s) => (
                  <TabsTrigger key={s.service.id} value={s.service.id} className="flex-none px-4">
                    {serviceName(boot, s.service.id)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {roll.services.map((s) => (
                <TabsContent key={s.service.id} value={s.service.id} className="pt-2">
                  {panel(s)}
                </TabsContent>
              ))}
            </Tabs>
          )
        ) : null}
      </PageSkeleton>

      {action ? (
        // design: the phone's sticky action sits just above the bottom bar, whose height the shell publishes as --bottom-bar
        <div className="sticky bottom-[calc(var(--bottom-bar,0px)+0.75rem)] z-10 mt-6 lg:hidden [&_button]:w-full">
          <LogMenu
            intents={intents}
            onPick={(i) => open(i)}
            disabled={!ws.writable}
            size="lg"
            className="w-full shadow-md"
          />
        </div>
      ) : null}

      {dialog ? (
        <LogDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          intent={dialog.intent}
          defaults={dialog.defaults}
          onLogged={() => {
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PersonRow({
  row,
  edits,
  meal,
  register,
  onLeave,
  onExtra,
  onRemoveExtra,
  itemName: nameOf,
}: {
  row: RollRow;
  edits: boolean;
  meal: string;
  register: (el: HTMLElement | null) => void;
  onLeave: (on: boolean) => void;
  onExtra: () => void;
  onRemoveExtra: (itemId: string) => void;
  itemName: (id: string) => string;
}) {
  const { person, state } = row;
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{person.name}</p>
        {row.switched ? <p className="text-sm text-muted-foreground">Having {meal}</p> : null}
        {row.extras.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Extras for ${person.name}`}>
            {row.extras.map((x) => (
              <li key={x.itemId}>
                {edits && state === "eating" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Take off ${x.qty} ${nameOf(x.itemId)} for ${person.name}`}
                    onClick={() => onRemoveExtra(x.itemId)}
                  >
                    {x.qty} {nameOf(x.itemId)}
                    <XIcon aria-hidden="true" data-icon="inline-end" />
                  </Button>
                ) : (
                  <Badge variant="secondary">
                    {x.qty} {nameOf(x.itemId)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div ref={register} className="flex flex-wrap items-center gap-2">
        {edits ? (
          <>
            <ToggleGroup
              variant="outline"
              aria-label={person.name}
              value={[state]}
              onValueChange={(v: string[]) => {
                const next = v[0];
                if (next && next !== state) onLeave(next === "leave");
              }}
            >
              <ToggleGroupItem value="eating">Eating</ToggleGroupItem>
              <ToggleGroupItem value="leave">Leave</ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              disabled={state !== "eating"}
              aria-label={`Add an extra for ${person.name}`}
              onClick={onExtra}
            >
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              Extra
            </Button>
          </>
        ) : state === "leave" ? (
          <Badge variant="outline">
            <CalendarOffIcon aria-hidden="true" data-icon="inline-start" />
            On leave
          </Badge>
        ) : state === "off" ? (
          <Badge variant="outline">Kitchen off</Badge>
        ) : (
          <Badge variant="secondary">
            <CheckCircle2Icon aria-hidden="true" data-icon="inline-start" />
            Eating
          </Badge>
        )}
      </div>
    </li>
  );
}
