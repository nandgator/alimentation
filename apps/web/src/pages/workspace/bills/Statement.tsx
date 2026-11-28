import { isMoneyStatement, type MealStatementDto, type StatementDto } from "@alimentation/core";
import { Link, useParams } from "wouter";
import { EmptyState, NotAvailable, PageHeader, PageSkeleton } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useMonthParam } from "@/hooks/use-url-state";
import { refusalWords } from "../books/parts.tsx";
import { useWorkspace } from "../context.tsx";
import { monthShort, validMonth } from "./figures.ts";
import { StatementCard } from "./StatementCard.tsx";
import { useApi } from "./useApi.ts";

function StatementPage({ personId }: { personId: string }) {
  const ws = useWorkspace();
  const [rawMonth] = useMonthParam(ws.boot.currentMonth);
  const month = validMonth(rawMonth, ws.boot.currentMonth);
  const res = useApi<(StatementDto | MealStatementDto)[]>(
    `${ws.api}/statements?months=${month}&person=${encodeURIComponent(personId)}`,
  );
  const one = (res.data ?? []).filter(isMoneyStatement).find((s) => s.personId === personId);
  const name = ws.nameOf(personId);
  return (
    <>
      <PageHeader
        title={name}
        documentTitle={`${name} · Bills · ${monthShort(month)}`}
        description={`Bill for ${monthShort(month)}`}
        actions={
          <Button
            variant="outline"
            render={<Link href={`${ws.base}/bills?month=${month}`} />}
            nativeButton={false}
          >
            All bills
          </Button>
        }
      />
      {res.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{refusalWords(res.error)}</span>
            <Button type="button" variant="outline" size="sm" onClick={res.reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {res.loading ? (
        <PageSkeleton loading variant="form" />
      ) : one ? (
        <StatementCard statement={one} name={name} className="max-w-2xl" />
      ) : res.error ? null : (
        <EmptyState
          title={`No bill for ${monthShort(month)}`}
          description={`${name} was not eating in this month.`}
        />
      )}
    </>
  );
}

/** `/w/:slug/bills/:id`: one person's bill, as its own page (a phone opens it from the list; a desktop link can too). */
export function Statement() {
  const ws = useWorkspace();
  const { id = "" } = useParams();
  if (!ws.money || ws.role !== "admin" || !ws.boot.people.some((p) => p.id === id))
    return (
      <NotAvailable title="Page not found" backTo={`${ws.base}/bills`} backLabel="All bills">
        There is no such bill, or it is not yours to see.
      </NotAvailable>
    );
  return <StatementPage personId={id} />;
}
