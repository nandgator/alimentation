import {
  headline,
  isMoneyStatement,
  type LogEntryDto,
  type StatementDto,
} from "@alimentation/core";
import { useMemo } from "react";
import { Money, PageHeader } from "@/components/app";
import { plural } from "../../../format.ts";
import { dueOf, weekdayDay } from "../bills/figures.ts";
import { StatCard } from "../bills/StatCard.tsx";
import { useApi } from "../bills/useApi.ts";
import { useWorkspace } from "../context.tsx";
import { MealsOverview } from "./MealsOverview.tsx";
import { NeedsYou } from "./NeedsYou.tsx";
import { SetupChecklist } from "./SetupChecklist.tsx";
import { SharesTotals } from "./SharesTotals.tsx";
import { TodayStrip } from "./TodayStrip.tsx";
import { daySlots, eatingToday } from "./today.ts";

/**
 * The admin's Home (NAV-12, DAT-08): the setup checklist while there is any, what needs the admin, three figures
 * with the one that matters first, and today's meals. The kitchen's name is the title and the date its line.
 */
export function AdminHome() {
  const ws = useWorkspace();
  const { boot } = ws;
  const log = useApi<LogEntryDto[]>(`${ws.api}/log?from=${boot.today}&to=${boot.today}`);
  const eating = eatingToday(daySlots(boot, boot.today, log.data ?? []));

  const money = useMemo(() => boot.statements.filter(isMoneyStatement), [boot.statements]);
  const projected = money.length > 0 && money.every((s) => s.basis === "Projected");
  const totals = headline(money, boot.pendingClaims ?? 0);
  const owing = money.filter((s: StatementDto) => dueOf(s) > 0).length;

  return (
    <>
      <PageHeader
        title={boot.workspace.name}
        documentTitle="Home"
        description={weekdayDay(boot.today)}
      />
      <div className="flex flex-col gap-4">
        <SharesTotals />
        <SetupChecklist />
        {ws.money && money.length > 0 ? (
          <section aria-label="This month" className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Owed to the kitchen"
              href={`${ws.base}/bills`}
              caption={
                projected
                  ? "Projected to month end"
                  : owing > 0
                    ? `${owing} of ${plural(totals.people, "person", "people")} owe`
                    : "Nobody owes anything"
              }
            >
              <Money paise={totals.owed} />
            </StatCard>
            <StatCard label="Collected this month" caption="Confirmed payments">
              <Money paise={totals.paid} />
            </StatCard>
            <StatCard label="Eating today" href={`${ws.base}/today`} caption="People with a meal">
              {eating}
            </StatCard>
          </section>
        ) : null}
        {!ws.money && boot.statements.length > 0 ? <MealsOverview eating={eating} /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <NeedsYou />
          <TodayStrip log={log} />
        </div>
      </div>
    </>
  );
}
