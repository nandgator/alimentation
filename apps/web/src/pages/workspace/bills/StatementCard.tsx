import type { StatementDto } from "@alimentation/core";
import { PrinterIcon, Share2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Money, StatusBadge, toast } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { itemName } from "../../../catalogue.ts";
import { balance as balanceText, money, plural } from "../../../format.ts";
import { useWorkspace } from "../context.tsx";
import { dueOf, monthShort, rateOf, statusFor } from "./figures.ts";

/**
 * The page of a printed document: a card with a header, a body and a row of actions that is not printed. The
 * bill uses it, and so does the wipe receipt (`/r/:id`), so the two look like one family on paper.
 */
export function StatementFrame({
  title,
  subtitle,
  badge,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 print:shadow-none print:ring-0", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {badge}
      </header>
      <div className="px-4 py-4">{children}</div>
      {actions ? (
        <footer className="flex flex-wrap items-center gap-2 border-t px-4 pt-4 print:hidden">
          {actions}
        </footer>
      ) : null}
    </Card>
  );
}

/** What can be said of a bill in a message: who, which month, and the three figures. */
function summary(s: StatementDto, name: string): string {
  const due = dueOf(s);
  return `${name}, ${monthShort(s.month)}: billed ${money(s.billed)}, paid ${money(s.paid)}, ${
    due > 0 ? `${money(due)} due` : due < 0 ? balanceText(-due).toLowerCase() : "nothing due"
  }.`;
}

async function share(s: StatementDto, name: string) {
  const text = summary(s, name);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: `Bill for ${monthShort(s.month)}`, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success("Copied. Paste it into a message.");
  } catch (e) {
    // Closing the share sheet is not a failure.
    if (e instanceof DOMException && e.name === "AbortError") return;
    toast.error("Could not share this. Try Print instead.");
  }
}

/** The two buttons under a bill. Not printed. */
export function StatementActions({
  statement: s,
  name,
}: {
  statement: StatementDto;
  name: string;
}) {
  return (
    <>
      <Button type="button" variant="outline" onClick={() => void share(s, name)}>
        <Share2Icon aria-hidden="true" data-icon="inline-start" />
        Share receipt
      </Button>
      <Button type="button" variant="outline" onClick={() => window.print()}>
        <PrinterIcon aria-hidden="true" data-icon="inline-start" />
        Print
      </Button>
    </>
  );
}

/** How a bill's status is drawn beside its name: a forecast is labelled inside the bill itself. */
export function StatementBadges({ statement: s }: { statement: StatementDto }) {
  const { boot } = useWorkspace();
  const status = statusFor(s, boot.currentMonth);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.basis === "Projected" ? <StatusBadge status="projected" /> : null}
      {status && status.status !== "projected" ? (
        <StatusBadge status={status.status} label={status.label} />
      ) : null}
    </div>
  );
}

/**
 * The body of a bill, in the order a person checks it (DAT-12): the lines as item, how many, rate and amount,
 * then the subtotal, what was paid and the balance due, in bold.
 */
export function StatementBody({ statement: s, name }: { statement: StatementDto; name: string }) {
  const { boot } = useWorkspace();
  const due = dueOf(s);
  const extra: { key: string; label: string; qty: number | null; amount: number }[] = [
    ...(s.leaveAmount !== 0
      ? [{ key: "leave", label: "Leave charge", qty: s.counts.leave, amount: s.leaveAmount }]
      : []),
    ...(s.feeAmount !== 0
      ? [{ key: "fee", label: "Monthly fee", qty: null, amount: s.feeAmount }]
      : []),
    ...(s.changedAfterClose !== 0
      ? [
          {
            key: "after-close",
            label: "Left out: changed after the month closed",
            qty: null,
            amount: -s.changedAfterClose,
          },
        ]
      : []),
  ];
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {plural(s.counts.meals, "meal")}, {plural(s.counts.leave, "leave day")}
      </p>
      {s.changedAfterClose !== 0 ? (
        <Alert className="mb-4">
          <AlertDescription>
            This month was closed, and entries changed afterwards by{" "}
            {money(Math.abs(s.changedAfterClose))}. The bill stays as it was closed.
          </AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableCaption className="sr-only">
          {name}: bill for {monthShort(s.month)}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.lines.map((l) => {
            const rate = rateOf(l.qty, l.amount);
            return (
              <TableRow key={l.itemId}>
                <TableCell>{itemName(boot, l.itemId)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {rate ? (
                    <span title={rate.exact ? undefined : "Average: the price changed this month"}>
                      {rate.exact ? "" : "~"}
                      <Money paise={rate.paise} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <Money paise={l.amount} />
                </TableCell>
              </TableRow>
            );
          })}
          {extra.map((e) => (
            <TableRow key={e.key}>
              <TableCell className="whitespace-normal">{e.label}</TableCell>
              <TableCell className="text-right tabular-nums">{e.qty ?? ""}</TableCell>
              <TableCell />
              <TableCell className="text-right">
                <Money paise={e.amount} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableHead colSpan={3} className="font-normal">
              Subtotal
            </TableHead>
            <TableCell className="text-right">
              <Money paise={s.billed} />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead colSpan={3} className="font-normal">
              Payments
            </TableHead>
            <TableCell className="text-right">
              <Money paise={-s.paid} />
            </TableCell>
          </TableRow>
          {s.earlierUnpaid !== 0 ? (
            <TableRow>
              <TableHead colSpan={3} className="font-normal">
                {s.earlierUnpaid > 0 ? "Earlier unpaid" : "Credit from earlier months"}
              </TableHead>
              <TableCell className="text-right">
                <Money paise={s.earlierUnpaid} />
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow className="border-t-2 text-base">
            <TableHead colSpan={3} className="text-base font-semibold">
              Balance due
            </TableHead>
            <TableCell className="text-right text-base font-semibold">
              {due < 0 ? <Money paise={-due} credit /> : <Money paise={due} />}
            </TableCell>
          </TableRow>
          {s.claimedPending > 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="whitespace-normal text-sm text-muted-foreground">
                <Money paise={s.claimedPending} /> claimed, waiting to be confirmed. It is not
                counted above yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableFooter>
      </Table>
    </>
  );
}

/** One person's bill as a page of its own: who and which month, the badges, the body and the actions. */
export function StatementCard({
  statement: s,
  name,
  className,
}: {
  statement: StatementDto;
  /** Whose bill it is. */
  name: string;
  className?: string;
}) {
  const projected = s.basis === "Projected";
  return (
    <StatementFrame
      className={className}
      title={name}
      subtitle={
        <>
          Bill for {monthShort(s.month)}
          {projected ? ". Figures to date plus the rest of the month as planned" : ""}
        </>
      }
      badge={<StatementBadges statement={s} />}
      actions={<StatementActions statement={s} name={name} />}
    >
      <StatementBody statement={s} name={name} />
    </StatementFrame>
  );
}
