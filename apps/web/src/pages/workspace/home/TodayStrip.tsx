import type { LogEntryDto } from "@alimentation/core";
import { ArrowRightIcon } from "lucide-react";
import { Link } from "wouter";
import { PageSkeleton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { weekdayDay } from "../bills/figures.ts";
import { CardHeading } from "../bills/StatCard.tsx";
import type { Fetched } from "../bills/useApi.ts";
import { useWorkspace } from "../context.tsx";
import { type DaySlot, daySlots } from "./today.ts";

/** What one service is today, in a line. */
function SlotLine({ slot }: { slot: DaySlot }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
      <span className="font-medium">
        {slot.serviceName}
        {slot.mealName ? (
          <span className="font-normal text-muted-foreground"> · {slot.mealName}</span>
        ) : null}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {slot.state === "served"
          ? `${slot.eating} eating${slot.onLeave > 0 ? ` · ${slot.onLeave} on leave` : ""}`
          : slot.state === "holiday"
            ? `Holiday: ${slot.holiday}`
            : slot.state === "off"
              ? "Not cooking today"
              : "Nothing on the menu"}
      </span>
    </li>
  );
}

/** Today's menu and the headcount of each meal, with the way to Today. */
export function TodayStrip({ log }: { log: Fetched<LogEntryDto[]> }) {
  const ws = useWorkspace();
  const { boot } = ws;
  const slots = daySlots(boot, boot.today, log.data ?? []);
  return (
    <Card aria-labelledby="today-title">
      <CardHeader>
        <CardTitle>
          <CardHeading id="today-title">Today</CardHeading>
        </CardTitle>
        <CardDescription>{weekdayDay(boot.today)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {log.loading ? (
          <PageSkeleton loading variant="list" />
        ) : !boot.menu ? (
          <p className="text-sm text-muted-foreground">No menu yet, so no meals are counted.</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is served today.</p>
        ) : (
          <ul className="divide-y" aria-label="Meals today">
            {slots.map((s) => (
              <SlotLine key={s.serviceId} slot={s} />
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="self-start"
          render={<Link href={`${ws.base}/today`} />}
          nativeButton={false}
        >
          Open Today
          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}
