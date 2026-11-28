import { CheckIcon, PrinterIcon, XIcon } from "lucide-react";
import { Link, useParams } from "wouter";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
// TODO(WP10): swap for the shared site header; it is the receipt's only chrome.
import { AppBar } from "../components/Chrome.tsx";
import { StatementFrame } from "./workspace/bills/StatementCard.tsx";
import { useApi } from "./workspace/bills/useApi.ts";

interface Receipt {
  workspaceId: string;
  requestedAt: string;
  completedAt: string;
  digest: string;
  manifest: {
    placement: string;
    rowsRemoved: Record<string, number> | null;
    checks: Record<string, boolean>;
    accountsRemoved: number;
    oldCopiesRemoved: number;
    resumedAfterInterruption: boolean;
    remains: string[];
  };
}

const CHECKS: Record<string, string> = {
  keysDestroyed: "Keys destroyed",
  databaseGone: "Database removed",
  directoryEntryGone: "Directory entry gone",
  controlRecordsGone: "Memberships, invitations and usage gone",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** One line of the receipt: what it is, and its value. */
function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

/**
 * `/r/:id`: the receipt a kitchen's wipe leaves, as a printable page. It is the same card as a bill's statement,
 * so the two read as one family on paper. It names no one.
 */
export function ReceiptPage() {
  const { id = "" } = useParams();
  const r = useApi<Receipt>(`/api/receipts/${encodeURIComponent(id)}`);
  const data = r.data;
  return (
    <>
      <AppBar />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <PageHeader title="Wipe receipt" description="What was removed, and what was checked." />
        {r.loading ? <PageSkeleton loading variant="form" /> : null}
        {r.error ? (
          <div className="flex flex-col gap-4">
            {r.error.status === 404 ? (
              <EmptyState
                title="There is no receipt with that address"
                description="Check the link, or ask whoever sent it."
              />
            ) : (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.error.message}</span>
                  <Button type="button" variant="outline" size="sm" onClick={r.reload}>
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <Button
              variant="outline"
              className="self-start"
              render={<Link href="/" />}
              nativeButton={false}
            >
              Home
            </Button>
          </div>
        ) : null}
        {data ? (
          <StatementFrame
            title={data.workspaceId}
            subtitle={`Requested ${when(data.requestedAt)} · completed ${when(data.completedAt)}${
              data.manifest.resumedAfterInterruption ? " (finished after an interruption)" : ""
            }`}
            actions={
              <Button type="button" variant="outline" onClick={() => window.print()}>
                <PrinterIcon aria-hidden="true" data-icon="inline-start" />
                Print
              </Button>
            }
          >
            <dl className="divide-y">
              <Line term="Checked">
                <ul className="flex flex-col gap-1">
                  {Object.entries(data.manifest.checks).map(([k, ok]) => (
                    <li key={k} className="flex items-center gap-2">
                      {ok ? (
                        <CheckIcon className="size-4 text-success-foreground" aria-hidden="true" />
                      ) : (
                        <XIcon className="size-4 text-destructive" aria-hidden="true" />
                      )}
                      <span>
                        {CHECKS[k] ?? k}
                        <span className="sr-only">{ok ? ": passed" : ": failed"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Line>
              {data.manifest.rowsRemoved ? (
                <Line term="Counted, never read">
                  {Object.entries(data.manifest.rowsRemoved)
                    .map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`)
                    .join(" · ")}
                </Line>
              ) : null}
              <Line term="What remains">{data.manifest.remains.join(". ")}.</Line>
              <Line term="Digest">
                <code className="break-all font-mono text-xs">{data.digest}</code>
              </Line>
            </dl>
            <p className="pt-3 text-sm font-medium">Names no one.</p>
          </StatementFrame>
        ) : null}
      </main>
    </>
  );
}
