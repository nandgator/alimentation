import { isMoneyStatement, type MealStatementDto, type StatementDto } from "@alimentation/core";
import { CircleCheckIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { api, getJson, postJson } from "@/api";
import {
  ConfirmAction,
  type DataColumn,
  DataTable,
  EmptyState,
  Money,
  MonthPicker,
  PageHeader,
  PageSkeleton,
  StatusBadge,
  toast,
} from "@/components/app";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { money, monthLong, plural } from "@/format";
import { useUrlState } from "@/hooks/use-url-state";
import { useWorkspace } from "../context.tsx";
import { LoadProblem, refusalWords, useLoad } from "./parts.tsx";

type Row = StatementDto | MealStatementDto;

const MONTH = /^\d{4}-\d{2}$/;

/** What a row is still waiting for before it is closed: a claim nobody has decided, a payment in question. */
const waitingWords = (s: Row): string | null => {
  if (!isMoneyStatement(s)) return null;
  const parts = [
    s.claimedPending > 0 ? `${money(s.claimedPending)} claimed, not decided` : null,
    s.openQueries > 0 ? `${plural(s.openQueries, "query", "queries")} open` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
};

/** One line of the checklist: done or not, what it is, and how many. */
function Check({
  done,
  bad,
  label,
  count,
  children,
}: {
  done: boolean;
  bad?: boolean;
  label: string;
  count: string;
  children?: ReactNode;
}) {
  const Icon = done ? CircleCheckIcon : bad ? TriangleAlertIcon : ClockIcon;
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-5 shrink-0 ${done ? "text-success-foreground" : bad ? "text-destructive" : "text-warning-foreground"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-medium">{label}</span>
          <span className="tabular-nums">{count}</span>
        </p>
        {children ? <p className="text-sm text-muted-foreground">{children}</p> : null}
      </div>
    </li>
  );
}

export function CloseMonths() {
  const ws = useWorkspace();
  const { boot } = ws;
  // The latest month a close makes sense for is the one that has ended.
  const closable = boot.months.filter((m) => m < boot.currentMonth);
  const firstMonth = boot.months[0] ?? boot.currentMonth;
  const lastMonth = boot.months.at(-1) ?? boot.currentMonth;
  const [asked, setMonth] = useUrlState("month", closable.at(-1) ?? boot.currentMonth);
  const selected = MONTH.test(asked) ? asked : (closable.at(-1) ?? boot.currentMonth);
  // What is ready to close: with prices for a kitchen that tracks money, with a menu for one that does not.
  const ready = ws.money ? !!boot.rateCard : !!boot.menu;
  const res = useLoad(
    () =>
      ready
        ? getJson<Row[]>(`${ws.api}/statements?months=${selected}`)
        : Promise.resolve([] as Row[]),
    [ws.api, selected, ready],
  );
  const rows = res.data ?? [];
  const open = rows.filter((s) => !s.closed);
  const claims = rows.filter((s) => isMoneyStatement(s) && s.claimedPending > 0).length;
  const queries = rows.filter((s) => isMoneyStatement(s) && s.openQueries > 0).length;
  const word = monthLong(selected);

  const reopen = async (s: Row) => {
    await api.del(`${ws.api}/closes/${selected}/${s.personId}`);
    res.reload();
  };
  const close = async (s: Row) => {
    await postJson(`${ws.api}/closes`, { month: selected, consumerId: s.personId });
    res.reload();
  };
  /** Closing and reopening are each the other's undo, so both act at once and offer to take it back (FRM-15). */
  const change = async (
    s: Row,
    doIt: (s: Row) => Promise<void>,
    back: (s: Row) => Promise<void>,
  ) => {
    try {
      await doIt(s);
      toast.undo(
        s.closed ? `${s.name}: ${word} reopened.` : `${s.name}: ${word} closed.`,
        async () => {
          try {
            await back(s);
          } catch (e) {
            toast.error(refusalWords(e));
          }
        },
      );
    } catch (e) {
      toast.error(refusalWords(e));
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      id: "name",
      header: "Name",
      cell: (s) => <span className="font-medium">{s.name}</span>,
      sort: (s) => s.name,
      search: (s) => s.name,
    },
    ...(ws.money
      ? ([
          {
            id: "live",
            header: "Live total",
            align: "end",
            cell: (s) => (isMoneyStatement(s) ? <Money paise={s.liveTotal} /> : null),
            sort: (s) => (isMoneyStatement(s) ? s.liveTotal : 0),
          },
          {
            id: "billed",
            header: "Billed",
            align: "end",
            cell: (s) =>
              isMoneyStatement(s) && s.closed ? (
                <Money paise={s.billed} />
              ) : (
                <span className="text-muted-foreground">Not yet</span>
              ),
            sort: (s) => (isMoneyStatement(s) && s.closed ? s.billed : -1),
          },
        ] satisfies DataColumn<Row>[])
      : ([
          {
            id: "meals",
            header: "Meals",
            align: "end",
            cell: (s) => (isMoneyStatement(s) ? null : s.counts.meals),
            sort: (s) => (isMoneyStatement(s) ? 0 : s.counts.meals),
          },
        ] satisfies DataColumn<Row>[])),
    {
      id: "state",
      header: "State",
      facet: {
        label: "State",
        value: (s) => (s.closed ? (ws.money ? "Closed" : "Locked") : "Open"),
      },
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1">
          {s.closed ? (
            <StatusBadge status="confirmed" label={ws.money ? "Closed" : "Locked"} />
          ) : (
            <StatusBadge status="pending" label="Open" />
          )}
          {isMoneyStatement(s) && s.changedAfterClose !== 0 ? (
            <StatusBadge
              status="disputed"
              label={`Changed after close ${money(s.changedAfterClose)}`}
            />
          ) : null}
        </div>
      ),
    },
    ...(ws.money
      ? ([
          {
            id: "waiting",
            header: "Still waiting",
            cell: (s) => waitingWords(s) ?? <span className="text-muted-foreground">Nothing</span>,
          },
        ] satisfies DataColumn<Row>[])
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Month end"
        description={
          ws.money
            ? "Closing freezes what each person is billed. Entries changed later show up as “changed after close” with the difference, and never alter the bill."
            : "Closing locks the month for each person, so nobody can change their meals, leave or extras after it."
        }
        actions={
          <MonthPicker
            value={selected}
            onChange={setMonth}
            min={firstMonth}
            max={lastMonth}
            label="Month to close"
          />
        }
      />
      <LoadProblem error={res.error} onRetry={res.reload} />
      {!ready ? (
        <EmptyState
          title={ws.money ? "Set the prices first" : "Set the menu first"}
          description={
            ws.money
              ? "A month can be closed once the kitchen has prices to bill with."
              : "A month can be closed once the kitchen has a menu."
          }
          action={
            <Link
              href={`${ws.base}/setup/${ws.money ? "prices" : "menu"}`}
              className={buttonVariants()}
            >
              {ws.money ? "Go to Prices" : "Go to Menu"}
            </Link>
          }
        />
      ) : (
        <PageSkeleton loading={res.loading && !res.data} variant="table">
          <div className="flex flex-col gap-6">
            <Card role="region" aria-label={`${word} checklist`}>
              <CardContent>
                <h2 className="mb-1 text-lg font-semibold">{word}</h2>
                <ul className="divide-y">
                  {ws.money ? (
                    <>
                      <Check done={claims === 0} label="To confirm" count={String(claims)}>
                        {claims === 0
                          ? "No payment is waiting for a decision."
                          : `${plural(claims, "person", "people")} with a payment claim waiting. Claims can still be decided after the close.`}
                      </Check>
                      <Check done={queries === 0} bad label="Disputed" count={String(queries)}>
                        {queries === 0
                          ? "No payment is in question."
                          : `${plural(queries, "person", "people")} with a payment in question.`}
                      </Check>
                    </>
                  ) : null}
                  <Check
                    done={rows.length > 0 && open.length === 0}
                    label={ws.money ? "Bills open" : "Months open"}
                    count={`${open.length} of ${rows.length}`}
                  >
                    {rows.length === 0
                      ? "Nobody has a bill in this month."
                      : open.length === 0
                        ? `${word} is closed for everyone.`
                        : ws.money
                          ? "Closing freezes meals, leave and extras for them."
                          : "Closing locks meals, leave and extras for them."}
                  </Check>
                </ul>
                {open.length > 0 ? (
                  <div className="mt-3">
                    <ConfirmAction
                      level="confirm"
                      trigger={
                        <Button type="button" disabled={!ws.writable}>{`Close ${word}`}</Button>
                      }
                      title={`Close ${word} for everyone?`}
                      description={
                        <>
                          {ws.money
                            ? `This freezes ${plural(open.length, "bill")}.`
                            : `This locks ${plural(open.length, "month")}.`}{" "}
                          You can reopen any of them afterwards, and the reopening is recorded.
                          {open.some(
                            (s) =>
                              isMoneyStatement(s) && (s.claimedPending > 0 || s.openQueries > 0),
                          )
                            ? " Some of them still have a claim waiting for the supplier, or a query open. Those carry on after the close."
                            : ""}
                        </>
                      }
                      confirmLabel={`Close ${word}`}
                      cancelLabel="Not yet"
                      onConfirm={async () => {
                        await postJson(`${ws.api}/closes`, { month: selected });
                        toast.success(`${word} closed.`);
                        res.reload();
                      }}
                    />
                  </div>
                ) : null}
                {ws.money ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Payments are not frozen: a claim can still be made, confirmed or settled after
                    the month is closed. What happens to entries made after the close is set under{" "}
                    <Link
                      href={`${ws.base}/setup/rules`}
                      className="text-primary underline underline-offset-4"
                    >
                      Entries after close in Rules
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    You can reopen a month for a person if something has to change.
                  </p>
                )}
              </CardContent>
            </Card>
            {rows.length === 0 ? (
              <EmptyState
                title="Nobody to close"
                description={`No one has a bill in ${word}. Pick another month.`}
              />
            ) : (
              <DataTable<Row>
                data={rows}
                columns={columns}
                getRowId={(s) => s.personId}
                caption={`${word}: who is closed`}
                searchLabel="Search people"
                rowLabel={(s) => s.name}
                rowActions={
                  ws.writable
                    ? (s) =>
                        s.closed ? (
                          <DropdownMenuItem onClick={() => void change(s, reopen, close)}>
                            Reopen
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void change(s, close, reopen)}>
                            Close
                          </DropdownMenuItem>
                        )
                    : undefined
                }
                mobile={{
                  title: (s) => s.name,
                  description: (s) =>
                    waitingWords(s) ??
                    (isMoneyStatement(s)
                      ? s.closed
                        ? `Billed ${money(s.billed)}`
                        : `Live total ${money(s.liveTotal)}`
                      : `${plural(s.counts.meals, "meal")}`),
                  trailing: (s) =>
                    s.closed ? (
                      <StatusBadge status="confirmed" label={ws.money ? "Closed" : "Locked"} />
                    ) : (
                      <StatusBadge status="pending" label="Open" />
                    ),
                }}
              />
            )}
          </div>
        </PageSkeleton>
      )}
    </>
  );
}
