import { type ClaimDto, type LogEntryDto, monthStart } from "@alimentation/core";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Money, PageSkeleton } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { plural } from "../../../format.ts";
import { monthShort } from "../bills/figures.ts";
import { CardHeading } from "../bills/StatCard.tsx";
import { useApi } from "../bills/useApi.ts";
import { useWorkspace } from "../context.tsx";

/** One row: what waits, and the way to it. */
function Row({ children, to, label }: { children: ReactNode; to: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 text-sm">{children}</span>
      <Button variant="outline" size="sm" render={<Link href={to} />} nativeButton={false}>
        {label}
      </Button>
    </li>
  );
}

/**
 * "Needs you" (the admin's Home): the claims of payment to confirm (the first three), the disputed ones, and the
 * entries logged after the day they are for. Empty, it says so. A kitchen without money has only the entries.
 */
export function NeedsYou() {
  const ws = useWorkspace();
  const { boot } = ws;
  const from = monthStart(boot.currentMonth);
  const claims = useApi<ClaimDto[]>(ws.money ? `${ws.api}/claims` : null);
  const log = useApi<LogEntryDto[]>(`${ws.api}/log?from=${from}&to=${boot.today}`);

  const list = claims.data ?? [];
  const pending = list.filter((c) => c.status === "Pending");
  const disputed = list.filter((c) => c.status === "Disputed");
  const late = (log.data ?? []).filter((e) => e.lateByDays > 0);
  const loading = (ws.money && claims.loading) || log.loading;
  const nothing = pending.length + disputed.length + late.length === 0;
  const failed = claims.error ?? log.error;

  return (
    <Card aria-labelledby="needs-title">
      <CardHeader>
        <CardTitle>
          <CardHeading id="needs-title">Needs you</CardHeading>
        </CardTitle>
        {!loading && !nothing ? (
          <CardDescription>
            {plural(pending.length + disputed.length + (late.length ? 1 : 0), "thing")} waiting
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <PageSkeleton loading variant="list" />
        ) : failed && nothing ? (
          <p className="text-sm text-muted-foreground">
            This could not be read just now.{" "}
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => {
                claims.reload();
                log.reload();
              }}
            >
              Try again
            </Button>
          </p>
        ) : nothing ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckIcon className="size-4 text-success-foreground" aria-hidden="true" />
            Nothing waiting.
          </p>
        ) : (
          <ul className="divide-y">
            {pending.length > 0 ? (
              <li className="py-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  To confirm <Badge variant="secondary">{pending.length}</Badge>
                </h3>
                <ul className="divide-y">
                  {pending.slice(0, 3).map((c) => (
                    <Row key={c.id} to={`${ws.base}/payments`} label="Open">
                      {ws.nameOf(c.consumerId)} paid{" "}
                      <Money paise={c.amount} className="font-medium" /> for{" "}
                      {monthShort(c.forMonth)}
                    </Row>
                  ))}
                </ul>
                {pending.length > 3 ? (
                  <p className="pt-1 text-sm">
                    <Link
                      href={`${ws.base}/payments`}
                      className="underline-offset-4 hover:underline"
                    >
                      See all {pending.length}
                    </Link>
                  </p>
                ) : null}
              </li>
            ) : null}
            {disputed.length > 0 ? (
              <li className="py-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  Disputed <Badge variant="secondary">{disputed.length}</Badge>
                </h3>
                <ul className="divide-y">
                  {disputed.slice(0, 3).map((c) => (
                    <Row key={c.id} to={`${ws.base}/payments`} label="Open">
                      {ws.nameOf(c.consumerId)}, <Money paise={c.amount} className="font-medium" />{" "}
                      for {monthShort(c.forMonth)}
                    </Row>
                  ))}
                </ul>
              </li>
            ) : null}
            {late.length > 0 ? (
              <Row to={`${ws.base}/books/audit`} label="See who">
                <span className="font-medium">{plural(late.length, "entry", "entries")}</span>{" "}
                logged after the day they are for, this month
              </Row>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
