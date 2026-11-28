import type { MealStatementDto, StatementDto } from "@alimentation/core";
import { LockIcon } from "lucide-react";
import { useMemo } from "react";
import { DataTable, EmptyState } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { chartMonths, monthShort } from "../bills/figures.ts";
import { MonthlyChart } from "../bills/MonthlyChart.tsx";
import { CardHeading, StatCard } from "../bills/StatCard.tsx";
import { useApi } from "../bills/useApi.ts";
import { useWorkspace } from "../context.tsx";

const isMeals = (s: StatementDto | MealStatementDto): s is MealStatementDto => !("billed" in s);
const extrasOf = (s: MealStatementDto) => Object.values(s.counts.addOns).reduce((a, n) => a + n, 0);
const sum = (xs: readonly MealStatementDto[], f: (s: MealStatementDto) => number) =>
  xs.reduce((a, s) => a + f(s), 0);

/** The Home of a kitchen without money: meals, leave days and extras, who ate how much, and the months so far. */
export function MealsOverview({ eating }: { eating: number }) {
  const ws = useWorkspace();
  const { boot } = ws;
  const month = boot.currentMonth;
  const range = useMemo(() => chartMonths(month, boot.months[0] ?? month), [month, boot.months]);
  const six = useApi<(StatementDto | MealStatementDto)[]>(
    boot.menu ? `${ws.api}/statements?months=${range.join(",")}` : null,
  );
  const mine = boot.statements.filter(isMeals);
  const all = (six.data ?? []).filter(isMeals);
  const projected = range.map((m) => {
    const here = all.filter((s) => s.month === m);
    return here.length > 0 && here.every((s) => s.basis === "Projected");
  });
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="This month" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Meals this month"
          caption={
            mine.every((s) => s.basis === "Projected") ? "Projected to month end" : undefined
          }
        >
          {sum(mine, (s) => s.counts.meals)}
        </StatCard>
        <StatCard label="Leave days">{sum(mine, (s) => s.counts.leave)}</StatCard>
        <StatCard label="Eating today" href={`${ws.base}/today`} caption="People with a meal">
          {eating}
        </StatCard>
      </section>

      <Card aria-labelledby="meals-title">
        <CardHeader>
          <CardTitle>
            <CardHeading id="meals-title">Meals each month</CardHeading>
          </CardTitle>
          <CardDescription>All the people together.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyChart
            testId="meals-chart"
            months={range}
            projected={projected}
            series={[
              {
                key: "meals",
                label: "Meals",
                color: "var(--chart-1)",
                values: range.map((m) =>
                  sum(
                    all.filter((s) => s.month === m),
                    (s) => s.counts.meals,
                  ),
                ),
              },
            ]}
            format={(n) => String(n)}
            axis={(n) => String(n)}
            label="Meals in each of the last months"
          />
        </CardContent>
      </Card>

      <section aria-label="People" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Who ate in {monthShort(month)}</h2>
        <DataTable<MealStatementDto>
          data={mine}
          getRowId={(s) => s.personId}
          caption={`Meals in ${monthShort(month)}`}
          searchLabel="Search people"
          initialSort={{ id: "name" }}
          columns={[
            {
              id: "name",
              header: "Name",
              sort: (s) => s.name,
              search: (s) => s.name,
              cell: (s) => <span className="font-medium">{s.name}</span>,
            },
            {
              id: "meals",
              header: "Meals",
              align: "end",
              sort: (s) => s.counts.meals,
              cell: (s) => s.counts.meals,
            },
            {
              id: "leave",
              header: "Leave",
              align: "end",
              sort: (s) => s.counts.leave,
              cell: (s) => s.counts.leave,
            },
            {
              id: "extras",
              header: "Extras",
              align: "end",
              sort: extrasOf,
              cell: extrasOf,
            },
            {
              id: "month",
              header: "Month",
              cell: (s) =>
                s.closed ? (
                  <Badge variant="secondary">
                    <LockIcon aria-hidden="true" data-icon="inline-start" />
                    Locked
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Open</span>
                ),
            },
          ]}
          mobile={{
            title: (s) => s.name,
            description: (s) =>
              `${s.counts.leave} on leave · ${extrasOf(s)} extra${extrasOf(s) === 1 ? "" : "s"}`,
            trailing: (s) => (
              <span className="text-lg font-semibold tabular-nums">{s.counts.meals}</span>
            ),
          }}
          empty={<EmptyState title="Nobody has eaten yet" />}
        />
      </section>
    </div>
  );
}
