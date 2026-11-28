import {
  headline,
  isMoneyStatement,
  type MealStatementDto,
  type StatementDto,
} from "@alimentation/core";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  DataTable,
  EmptyState,
  Money,
  NotAvailable,
  PageHeader,
  PageSkeleton,
  StatusBadge,
  UrlMonthPicker,
} from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsNarrow } from "@/hooks/use-media-query";
import { useMonthParam } from "@/hooks/use-url-state";
import { money } from "../../../format.ts";
import { setupChecklist } from "../../../setup.ts";
import { refusalWords } from "../books/parts.tsx";
import { useWorkspace } from "../context.tsx";
import {
  chartMonths,
  dueOf,
  monthShort,
  monthTotals,
  statusFor,
  statusWord,
  validMonth,
} from "./figures.ts";
import { MonthlyChart } from "./MonthlyChart.tsx";
import { StatCard } from "./StatCard.tsx";
import { StatementActions, StatementBadges, StatementBody } from "./StatementCard.tsx";
import { useApi } from "./useApi.ts";

/** The balance of a person as the table shows it: what they owe, or the credit they hold. */
function Balance({ s, big }: { s: StatementDto; big?: boolean }) {
  const due = dueOf(s);
  return (
    <span className={big ? "text-lg font-semibold" : "font-medium"}>
      {due < 0 ? <Money paise={-due} credit /> : <Money paise={due} />}
    </span>
  );
}

function StatusOf({ s }: { s: StatementDto }) {
  const { boot } = useWorkspace();
  const st = statusFor(s, boot.currentMonth);
  return st ? (
    <StatusBadge status={st.status} label={st.label} />
  ) : (
    <span className="text-muted-foreground">No bill</span>
  );
}

/** The month's range of statements for the whole kitchen: this month for the table, six months for the chart. */
function useBillStatements(month: string) {
  const ws = useWorkspace();
  const { boot } = ws;
  const first = boot.months[0] ?? boot.currentMonth;
  const range = useMemo(() => chartMonths(month, first), [month, first]);
  const billable = Boolean(boot.menu && boot.rateCard);
  const res = useApi<(StatementDto | MealStatementDto)[]>(
    billable ? `${ws.api}/statements?months=${range.join(",")}` : null,
  );
  const all = useMemo(() => (res.data ?? []).filter(isMoneyStatement), [res.data]);
  return { ...res, all, range, billable };
}

function BillsPage() {
  const ws = useWorkspace();
  const { boot } = ws;
  const [, go] = useLocation();
  const narrow = useIsNarrow();
  const last = boot.months[boot.months.length - 1];
  const max = last && last > boot.currentMonth ? last : boot.currentMonth;
  const [rawMonth] = useMonthParam(boot.currentMonth);
  const month = validMonth(rawMonth, boot.currentMonth);
  const { all, range, loading, refreshing, error, reload, billable } = useBillStatements(month);
  const [open, setOpen] = useState<string | null>(null);

  const mine = useMemo(() => all.filter((s) => s.month === month), [all, month]);
  const projected = mine.length > 0 && mine.every((s) => s.basis === "Projected");
  const totals = headline(mine, boot.pendingClaims ?? 0);
  const monthly = useMemo(() => monthTotals(all, range), [all, range]);
  const selected = mine.find((s) => s.personId === open) ?? null;
  const next = setupChecklist({
    money: true,
    today: boot.today,
    hints: boot.setup,
    services: boot.services,
    catalogue: boot.catalogue,
  }).find((s) => !s.done);

  const statementHref = (s: StatementDto) => `${ws.base}/bills/${s.personId}?month=${s.month}`;
  const openOne = (s: StatementDto) => (narrow ? go(statementHref(s)) : setOpen(s.personId));
  // The first read for this month: the old month's figures are not shown under the new month's name.
  const waiting = loading || (refreshing && mine.length === 0);

  return (
    <>
      <PageHeader
        title="Bills"
        documentTitle={`Bills · ${monthShort(month)}`}
        description="What each person owes for the month, and how much has come in."
        actions={
          <>
            {projected ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex" tabIndex={0}>
                      <StatusBadge status="projected" />
                    </span>
                  }
                />
                <TooltipContent>
                  Figures to date plus the rest of the month as planned.
                </TooltipContent>
              </Tooltip>
            ) : null}
            <UrlMonthPicker
              fallback={boot.currentMonth}
              min={boot.months[0] ?? boot.currentMonth}
              max={max}
            />
          </>
        }
      />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{refusalWords(error)}</span>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!billable || boot.people.every((p) => p.role !== "consumer") ? (
        <EmptyState
          title="Nothing to bill yet"
          description="Bills appear once the kitchen has people, a menu and prices."
          action={
            next ? (
              <Button render={<Link href={`${ws.base}${next.to}`} />} nativeButton={false}>
                {next.label}
              </Button>
            ) : undefined
          }
        />
      ) : waiting ? (
        <div className="flex flex-col gap-6">
          <PageSkeleton loading variant="stats" />
          <PageSkeleton loading variant="table" />
        </div>
      ) : error && mine.length === 0 ? null : mine.length === 0 ? (
        <EmptyState
          title={`No bills for ${monthShort(month)}`}
          description="Nobody was eating in this month, so there is nothing to bill."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="This month" className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Billed" caption={projected ? "Projected to month end" : undefined}>
              <Money paise={totals.billed} />
            </StatCard>
            <StatCard label="Collected" caption="Confirmed payments">
              <Money paise={totals.paid} />
            </StatCard>
            <StatCard
              label="Owed"
              caption={projected ? "Projected to month end" : "Including earlier months"}
              href={undefined}
            >
              <Money paise={totals.owed} />
            </StatCard>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Billed and collected</CardTitle>
              <CardDescription>
                The last {range.length === 1 ? "month" : `${range.length} months`}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MonthlyChart
                testId="bills-chart"
                months={range}
                projected={monthly.map((m) => m.projected)}
                series={[
                  {
                    key: "billed",
                    label: "Billed",
                    color: "var(--chart-1)",
                    values: monthly.map((m) => m.billed),
                  },
                  {
                    key: "collected",
                    label: "Collected",
                    color: "var(--chart-2)",
                    values: monthly.map((m) => m.collected),
                  },
                ]}
                format={(n) => money(n)}
                label="Billed and collected in each of the last months"
              />
            </CardContent>
          </Card>

          <section aria-label="People" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Who owes what</h2>
            <DataTable<StatementDto>
              data={mine}
              getRowId={(s) => s.personId}
              caption={`Bills for ${monthShort(month)}`}
              searchLabel="Search people"
              initialSort={{ id: "balance", desc: true }}
              onRowClick={openOne}
              columns={[
                {
                  id: "name",
                  header: "Name",
                  sort: (s) => s.name,
                  search: (s) => s.name,
                  cell: (s) => (
                    <Button
                      variant="link"
                      className="h-auto p-0 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        openOne(s);
                      }}
                    >
                      {s.name}
                    </Button>
                  ),
                },
                {
                  id: "balance",
                  header: "Balance",
                  align: "end",
                  sort: dueOf,
                  cell: (s) => <Balance s={s} />,
                },
                {
                  id: "status",
                  header: "Status",
                  sort: (s) => statusWord(statusFor(s, boot.currentMonth)),
                  facet: {
                    label: "Status",
                    value: (s) => statusWord(statusFor(s, boot.currentMonth)) || null,
                  },
                  cell: (s) => <StatusOf s={s} />,
                },
              ]}
              mobile={{
                title: (s) => s.name,
                description: (s) => <StatusOf s={s} />,
                trailing: (s) => <Balance s={s} big />,
              }}
              empty={<EmptyState title="No bills yet" />}
            />
          </section>
        </div>
      )}

      <Sheet open={selected !== null} onOpenChange={(o) => (o ? null : setOpen(null))}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>Bill for {monthShort(selected.month)}</SheetDescription>
                <StatementBadges statement={selected} />
              </SheetHeader>
              <div className="px-4">
                <StatementBody statement={selected} name={selected.name} />
              </div>
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                <StatementActions statement={selected} name={selected.name} />
                <Button
                  variant="ghost"
                  render={<Link href={statementHref(selected)} />}
                  nativeButton={false}
                >
                  Open as a page
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** `/w/:slug/bills`: what each person owes for a month, a chart of the last six, and a bill from each row. */
export function Bills() {
  const ws = useWorkspace();
  // A kitchen that does not track money has no bills; the menu has no such entry, and an address is told so.
  if (!ws.money || ws.role !== "admin")
    return (
      <NotAvailable
        title={ws.money ? "This is for admins" : "Page not found"}
        backTo={ws.base}
        backLabel="Go to your home"
      >
        {ws.money ? "Bills are open to admins." : "This kitchen does not track money."}
      </NotAvailable>
    );
  return <BillsPage />;
}
