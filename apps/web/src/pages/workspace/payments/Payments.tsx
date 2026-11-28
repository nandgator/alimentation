import type { ClaimDto } from "@alimentation/core";
import { AlertCircleIcon, IndianRupeeIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, postJson } from "@/api";
import {
  ConfirmAction,
  EmptyState,
  Money,
  NotAvailable,
  PageHeader,
  PageSkeleton,
  StatusBadge,
  toast,
} from "@/components/app";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money, monthLong } from "@/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useUrlState } from "@/hooks/use-url-state";
import { useWorkspace } from "../context.tsx";
import { ClaimsTable } from "./ClaimsTable.tsx";
import { dueOf, inTab, isTab, TABS, type TabValue } from "./claims.ts";
import { DecideDialog, type DecideMode } from "./DecideDialog.tsx";
import { PayDialog } from "./PayDialog.tsx";
import { useClaims } from "./useClaims.ts";

/** The page's one primary action: in the header on a wide screen, above the bottom bar on a phone. */
function PrimaryAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const button = (
    <Button type="button" onClick={onClick} className={wide ? undefined : "w-full"}>
      <IndianRupeeIcon aria-hidden="true" data-icon="inline-start" />
      {children}
    </Button>
  );
  if (wide) return button;
  return (
    <div className="fixed inset-x-0 bottom-[var(--bottom-bar)] z-20 border-t bg-background px-4 py-2">
      {button}
    </div>
  );
}

export function Payments() {
  const ws = useWorkspace();
  if (!ws.money)
    return (
      <NotAvailable title="No payments here" backTo={ws.base} backLabel="Go to Home">
        This kitchen tracks meals only, so there are no bills or payments.
      </NotAvailable>
    );
  return <PaymentsScreen />;
}

function PaymentsScreen() {
  const ws = useWorkspace();
  const claims = useClaims(ws.api);
  const consumer = ws.role === "consumer";
  const decider = ws.role === "supplier"; // only the cook decides; the admin can reverse a decision
  const [tabParam, setTab] = useUrlState("tab", "to-confirm");
  const tab: TabValue = isTab(tabParam) ? tabParam : "to-confirm";

  const [paying, setPaying] = useState(false);
  const [deciding, setDeciding] = useState<{ claim: ClaimDto; mode: DecideMode } | null>(null);
  const [withdrawing, setWithdrawing] = useState<ClaimDto | null>(null);

  const list = claims.data ?? [];
  const mine = consumer ? list.filter((c) => c.consumerId === ws.boot.me.personId) : list;
  const waiting = list.filter((c) => c.status === "Pending");
  const direct = consumer && ws.boot.policy.payments === "direct";
  const canPay = ws.writable && (consumer ? !direct : ws.role === "admin");

  const refresh = () => {
    claims.reload();
    ws.reload();
  };

  const actions = {
    confirm: (c: ClaimDto) =>
      void postJson(`${ws.api}/claims/${c.id}/decision`, { decision: "Confirmed" }).then(
        () => {
          toast.success(`Confirmed ${money(c.amount)} from ${ws.nameOf(c.consumerId)}.`);
          refresh();
        },
        (e: Error) => toast.error(e.message),
      ),
    dispute: (claim: ClaimDto) => setDeciding({ claim, mode: "dispute" }),
    reverse: (claim: ClaimDto) => setDeciding({ claim, mode: "reverse" }),
    withdraw: (c: ClaimDto) => setWithdrawing(c),
  };

  const failed = claims.error ? (
    <Alert variant="destructive" className="mb-4">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>Payments could not be loaded</AlertTitle>
      <AlertDescription>
        {claims.data ? "What is shown may be out of date. " : ""}
        {claims.error.message}
      </AlertDescription>
      <AlertAction>
        <Button type="button" size="sm" variant="outline" onClick={claims.reload}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  ) : null;

  const dialogs = (
    <>
      {canPay ? <PayDialog open={paying} onOpenChange={setPaying} onDone={refresh} /> : null}
      <DecideDialog
        claim={deciding?.claim ?? null}
        mode={deciding?.mode ?? "dispute"}
        onClose={() => setDeciding(null)}
        onDone={refresh}
      />
      <ConfirmAction
        level="confirm"
        open={withdrawing !== null}
        onOpenChange={(o) => {
          if (!o) setWithdrawing(null);
        }}
        title="Withdraw this claim?"
        description={
          withdrawing
            ? `${ws.nameOf(withdrawing.consumerId)}'s ${monthLong(withdrawing.forMonth)} claim of ${money(withdrawing.amount)} is removed. It was never confirmed, so no bill changes.`
            : undefined
        }
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (!withdrawing) return;
          await api.del(`${ws.api}/claims/${withdrawing.id}`);
          toast.success("Claim withdrawn.");
          setWithdrawing(null);
          refresh();
        }}
      />
    </>
  );

  if (consumer) {
    const owing = dueOf(ws.boot.statements, ws.boot.me.personId);
    const due = owing?.due ?? 0;
    return (
      <>
        <PageHeader
          title="Pay"
          description="What you owe the kitchen, and the payments you have told it about."
          actions={
            canPay ? <PrimaryAction onClick={() => setPaying(true)}>I paid</PrimaryAction> : null
          }
        />
        {failed}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {due > 0 ? <StatusBadge status="owed" /> : <StatusBadge status="paid" />}
              <span className="text-sm text-muted-foreground">
                {monthLong(ws.boot.currentMonth)} and earlier
              </span>
            </div>
            <p className="text-3xl font-[650] tabular-nums">
              {due > 0 ? (
                <>
                  You owe <Money paise={due} />
                </>
              ) : due < 0 ? (
                <Money paise={-due} credit />
              ) : (
                "You're all paid up"
              )}
            </p>
            {owing && owing.claimed > 0 ? (
              <p className="text-sm text-muted-foreground">
                <Money paise={owing.claimed} /> claimed and waiting for the cook to confirm.
              </p>
            ) : null}
            {direct ? (
              <p className="text-sm text-muted-foreground">
                This kitchen records payments directly. Ask the cook when you have paid.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <h2 className="mb-2 text-lg font-semibold">Your payments</h2>
        <PageSkeleton loading={claims.loading && !claims.data} variant="table">
          <ClaimsTable
            claims={mine}
            actions={actions}
            showPerson={false}
            canDecide={false}
            empty={
              <EmptyState
                icon={IndianRupeeIcon}
                title="No payments yet"
                description="When you pay, tell the kitchen here. It shows as pending until the cook confirms it."
                action={
                  canPay ? (
                    <Button type="button" onClick={() => setPaying(true)}>
                      I paid
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </PageSkeleton>
        {dialogs}
      </>
    );
  }

  // The admin and the cook: one list, in tabs, one row per claim.
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v), { push: false })}>
      <PageHeader
        title="Payments"
        description={
          decider
            ? "Confirm what people say they paid, or dispute it with a reason."
            : "What people have paid. Only the cook confirms a payment."
        }
        actions={
          canPay ? (
            <PrimaryAction onClick={() => setPaying(true)}>Record a payment</PrimaryAction>
          ) : null
        }
        tabs={
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-none px-3">
                {t.label}
                {t.value === "to-confirm" && waiting.length > 0 ? (
                  <Badge variant="secondary">
                    {waiting.length}
                    <span className="sr-only"> waiting</span>
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />
      {failed}
      {!decider && waiting.length > 0 && tab === "to-confirm" ? (
        <p className="text-sm text-muted-foreground">
          Only the cook confirms a payment.
          {ws.boot.roles.includes("supplier") ? (
            <>
              {" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() => ws.switchRole("supplier")}
              >
                View as Cook
              </Button>{" "}
              to do it yourself.
            </>
          ) : null}
        </p>
      ) : null}
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="flex flex-col gap-3">
          <PageSkeleton loading={claims.loading && !claims.data} variant="table">
            <ClaimsTable
              claims={list.filter((c) => inTab(t.value, c))}
              actions={actions}
              showPerson
              canDecide={decider}
              empty={
                <EmptyState
                  icon={IndianRupeeIcon}
                  title={
                    t.value === "to-confirm"
                      ? "Nothing waiting"
                      : t.value === "all"
                        ? "No payments yet"
                        : `No ${t.label.toLowerCase()} payments`
                  }
                  description={
                    t.value === "all"
                      ? "Payments appear here once someone says they paid."
                      : "Nothing is in this list."
                  }
                />
              }
            />
          </PageSkeleton>
        </TabsContent>
      ))}
      {dialogs}
    </Tabs>
  );
}
