import { Link, useParams } from "wouter";
import { AppBar } from "../components/Chrome.tsx";
import { Problem, Spinner, useLoad } from "../components/ui.tsx";
import { getJson } from "../api.ts";

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

export function ReceiptPage() {
  const { id = "" } = useParams();
  const r = useLoad(() => getJson<Receipt>(`/api/receipts/${encodeURIComponent(id)}`), [id]);
  return (
    <>
      <AppBar />
      <div class="narrow solo">
        {r.loading && !r.data ? <Spinner /> : null}
        {r.error ? (
          <div class="stack">
            <Problem
              error={r.error.status === 404 ? "There is no receipt with that address." : r.error}
            />
            <Link href="/">← Home</Link>
          </div>
        ) : null}
        {r.data ? (
          <figure class="receipt flat">
            <figcaption>Wipe receipt</figcaption>
            <dl>
              <div>
                <dt>Workspace</dt>
                <dd class="mono">{r.data.workspaceId}</dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>
                  {when(r.data.requestedAt)} · completed {when(r.data.completedAt)}
                  {r.data.manifest.resumedAfterInterruption
                    ? " (finished after an interruption)"
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>
                  {Object.entries(r.data.manifest.checks).map(([k, ok]) => (
                    <div key={k}>
                      <span class={`tick ${ok ? "ok" : "bad"}`}>{ok ? "✓" : "✗"}</span>
                      {CHECKS[k] ?? k}
                    </div>
                  ))}
                </dd>
              </div>
              {r.data.manifest.rowsRemoved ? (
                <div>
                  <dt>Counted, never read</dt>
                  <dd>
                    {Object.entries(r.data.manifest.rowsRemoved)
                      .map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`)
                      .join(" · ")}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>What remains</dt>
                <dd>{r.data.manifest.remains.join(". ")}.</dd>
              </div>
              <div>
                <dt>Digest</dt>
                <dd class="mono">{r.data.digest}</dd>
              </div>
            </dl>
            <p class="seal">Names no one.</p>
          </figure>
        ) : null}
      </div>
    </>
  );
}
