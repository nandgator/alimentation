import {
  addDays,
  type HistoryEventDto,
  type IsoDate,
  isMoneyStatement,
  type LogEntryDto,
  type MealStatementDto,
  type StatementDto,
} from "@alimentation/core";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Money, PageHeader, PageSkeleton, StatusBadge, toast } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useIsNarrow } from "@/hooks/use-media-query";
import { ApiFailure, api } from "../../../api.ts";
import { everSeveral } from "../../../catalogue.ts";
import { ago, monthLong, plural } from "../../../format.ts";
import { dueOf, statusFor, weekdayDay } from "../bills/figures.ts";
import { CardHeading } from "../bills/StatCard.tsx";
import { StatementBody } from "../bills/StatementCard.tsx";
import { useApi } from "../bills/useApi.ts";
import { useWorkspace } from "../context.tsx";
import { SharesTotals } from "./SharesTotals.tsx";
import { type DaySlot, daySlots } from "./today.ts";

/** The hero: what the person owes, in one sentence, with the one thing to do about it. */
function Hero({ statement: s }: { statement: StatementDto | undefined }) {
  const ws = useWorkspace();
  const { boot } = ws;
  const month = monthLong(boot.currentMonth);
  if (!s)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <CardHeading>Your bill</CardHeading>
          </CardTitle>
          <CardDescription>
            Your bill will show here once the kitchen has a menu and prices.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  const due = dueOf(s);
  const st = statusFor(s, boot.currentMonth);
  return (
    <Card aria-labelledby="hero-title">
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {month}
          {st ? <StatusBadge status={st.status} label={st.label} /> : null}
          {s.basis === "Projected" && st?.status !== "projected" ? (
            <StatusBadge status="projected" />
          ) : null}
        </CardDescription>
        <CardTitle>
          <h2 id="hero-title" className="text-2xl font-[650] tracking-tight">
            {due > 0 ? (
              <>
                You owe <Money paise={due} />
                {s.earlierUnpaid <= 0 ? ` for ${month}` : ""}
              </>
            ) : due < 0 ? (
              <Money paise={-due} credit />
            ) : s.billed > 0 ? (
              "You're all paid up"
            ) : (
              "Nothing to pay yet"
            )}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {s.earlierUnpaid > 0 && due > 0 ? (
            <>
              Includes <Money paise={s.earlierUnpaid} /> from earlier months.{" "}
            </>
          ) : null}
          {s.claimedPending > 0 ? (
            <>
              You have claimed <Money paise={s.claimedPending} />, waiting to be confirmed.{" "}
            </>
          ) : null}
          {s.basis === "Projected" ? "Projected to month end. " : null}
          {due < 0 ? "You have paid ahead. " : null}
        </p>
        <Button
          size="lg"
          variant={due > 0 ? "default" : "outline"}
          className="w-full sm:w-auto sm:self-start"
          render={<Link href={`${ws.base}/payments`} />}
          nativeButton={false}
        >
          Pay
        </Button>
      </CardContent>
    </Card>
  );
}

/** A kitchen without money: how much the person ate this month, in the same place as the hero. */
function MealsHero({ statement: s }: { statement: MealStatementDto | undefined }) {
  const { boot } = useWorkspace();
  const month = monthLong(boot.currentMonth);
  const extras = s ? Object.values(s.counts.addOns).reduce((a, n) => a + n, 0) : 0;
  return (
    <Card aria-labelledby="hero-title">
      <CardHeader>
        <CardDescription>{month}</CardDescription>
        <CardTitle>
          <h2 id="hero-title" className="text-2xl font-[650] tracking-tight">
            {s ? plural(s.counts.meals, "meal") : "No meals yet"}
          </h2>
        </CardTitle>
      </CardHeader>
      {s ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {plural(s.counts.leave, "leave day")} · {plural(extras, "extra")}
            {s.basis === "Projected" ? ". Projected to month end." : "."}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Today and tomorrow, with a Skip on each meal that is still to come. A skip acts at once and offers Undo. */
function NextMeals() {
  const ws = useWorkspace();
  const { boot } = ws;
  const tomorrow = addDays(boot.today as IsoDate, 1);
  const log = useApi<LogEntryDto[]>(`${ws.api}/log?from=${boot.today}&to=${tomorrow}`);
  const [busy, setBusy] = useState<string | null>(null);
  const me = boot.me.personId;
  const several = everSeveral(boot);

  const days = [boot.today as IsoDate, tomorrow].map((date) => ({
    date,
    label: date === boot.today ? "Today" : "Tomorrow",
    // A service the person does not take has no row.
    slots: daySlots(boot, date, log.data ?? [], me).filter(
      (s) => s.state !== "served" || s.eating > 0,
    ),
  }));

  async function skip(date: IsoDate, label: string, slot: DaySlot) {
    setBusy(`${date}${slot.serviceId}`);
    try {
      const { data } = await api.post<{ id: string }>(`${ws.api}/log`, {
        date,
        personId: me,
        allConsumers: false,
        action: "Leave",
        serviceId: several ? slot.serviceId : null,
        itemId: null,
        qty: null,
      });
      log.reload();
      toast.undo(`Skipped ${slot.serviceName} ${label.toLowerCase()}`, async () => {
        try {
          await api.del(`${ws.api}/log/${data.id}`);
          log.reload();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not undo that.");
        }
      });
    } catch (e) {
      toast.error(e instanceof ApiFailure ? e.message : "Could not skip that meal.");
    } finally {
      setBusy(null);
    }
  }

  async function eatAgain(date: IsoDate, slot: DaySlot) {
    if (!slot.leaveEntryId) return;
    setBusy(`${date}${slot.serviceId}`);
    try {
      await api.del(`${ws.api}/log/${slot.leaveEntryId}`);
      log.reload();
      toast.success(`${slot.serviceName} is back on`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card aria-labelledby="next-title">
      <CardHeader>
        <CardTitle>
          <CardHeading id="next-title">Your next meals</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {log.loading ? (
          <PageSkeleton loading variant="list" />
        ) : !boot.menu ? (
          <p className="text-sm text-muted-foreground">There is no menu yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {days.map((d) => (
              <section key={d.date} aria-label={d.label}>
                <h3 className="text-sm font-medium text-muted-foreground">{d.label}</h3>
                {d.slots.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Nothing is served.</p>
                ) : (
                  <ul className="divide-y">
                    {d.slots.map((s) => (
                      <li
                        key={s.serviceId}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{s.serviceName}</span>
                          {s.mealName ? (
                            <span className="text-muted-foreground"> · {s.mealName}</span>
                          ) : null}
                          {s.state === "holiday" ? (
                            <span className="block text-sm text-muted-foreground">
                              Holiday: {s.holiday}
                            </span>
                          ) : s.state === "off" ? (
                            <span className="block text-sm text-muted-foreground">Not cooking</span>
                          ) : s.state === "none" ? (
                            <span className="text-sm text-muted-foreground"> · not served</span>
                          ) : null}
                        </span>
                        {s.state === "served" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!ws.writable || busy === `${d.date}${s.serviceId}`}
                            aria-label={`Skip ${s.serviceName} ${d.label.toLowerCase()}`}
                            onClick={() => void skip(d.date, d.label, s)}
                          >
                            Skip
                          </Button>
                        ) : s.state === "leave" ? (
                          <span className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Skipped</span>
                            {s.leaveEntryId ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!ws.writable || busy === `${d.date}${s.serviceId}`}
                                aria-label={`Eat ${s.serviceName} ${d.label.toLowerCase()} after all`}
                                onClick={() => void eatAgain(d.date, s)}
                              >
                                Undo
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <Button
              variant="link"
              className="h-auto self-start p-0"
              render={<Link href={`${ws.base}/meals`} />}
              nativeButton={false}
            >
              More ways to change a meal
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The last three things that happened to the person's records. */
function Recent() {
  const ws = useWorkspace();
  const res = useApi<{ events: HistoryEventDto[] }>(`${ws.api}/history?limit=3`);
  const events = (res.data?.events ?? []).slice(0, 3);
  return (
    <Card aria-labelledby="recent-title">
      <CardHeader>
        <CardTitle>
          <CardHeading id="recent-title">Recent</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {res.loading ? (
          <PageSkeleton loading variant="list" />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
        ) : (
          <ul className="divide-y">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">{e.text}</span>
                <span className="shrink-0 text-muted-foreground">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`${ws.base}/history`}
          className="self-start text-sm underline-offset-4 hover:underline"
        >
          See all
        </Link>
      </CardContent>
    </Card>
  );
}

/** The bill of the month, folded: open on a wide screen, closed on a phone so the hero and the meals stay in view. */
function ThisMonth({ statement }: { statement: StatementDto }) {
  const { boot } = useWorkspace();
  const narrow = useIsNarrow();
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? !narrow;
  return (
    <Card>
      <Collapsible open={shown} onOpenChange={setOpen}>
        <CardHeader>
          <CardTitle>
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              }
            >
              <CardHeading>This month: {monthLong(boot.currentMonth)}</CardHeading>
              <ChevronDownIcon
                aria-hidden="true"
                className={`size-4 transition-transform ${shown ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <StatementBody statement={statement} name={boot.me.name} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * The consumer's Home: what they owe above the fold, this month's bill folded under it, the next two days of meals
 * with a Skip on each, and the latest things done to their records.
 */
export function ConsumerHome() {
  const ws = useWorkspace();
  const { boot } = ws;
  const mine = boot.statements.find((s) => s.personId === boot.me.personId);
  const money = mine && isMoneyStatement(mine) ? mine : undefined;
  return (
    <>
      <PageHeader
        title={boot.workspace.name}
        documentTitle="Home"
        description={`Hello, ${boot.me.name}. ${weekdayDay(boot.today)}`}
      />
      <div className="flex flex-col gap-4">
        <SharesTotals />
        {ws.money ? (
          <Hero statement={money} />
        ) : (
          <MealsHero statement={mine && !isMoneyStatement(mine) ? mine : undefined} />
        )}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <NextMeals />
          <div className="flex flex-col gap-4">
            {ws.money && money ? <ThisMonth statement={money} /> : null}
            <Recent />
          </div>
        </div>
      </div>
    </>
  );
}
