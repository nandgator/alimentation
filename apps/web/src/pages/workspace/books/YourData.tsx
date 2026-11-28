import { GRACE_DAYS } from "@alimentation/core";
import { ArchiveIcon, CircleCheckIcon, DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { getJson, postJson } from "@/api";
import {
  AppForm,
  ConfirmAction,
  FormField,
  PageHeader,
  SubmitButton,
  toast,
  useAppForm,
} from "@/components/app";
import { SOLID_DESTRUCTIVE } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { date } from "@/format";
import { bytesWords, monthWords, type Retention } from "../../../retention.ts";
import { useWorkspace } from "../context.tsx";
import { HeadOffice } from "../HeadOffice.tsx";
import { AgentKeys } from "./AgentKeys.tsx";
import { ActionProblem, Section, saveBlob, useLoad, useRun } from "./parts.tsx";

interface Preview {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
  digest: string | null;
  steps: string[];
}
interface Moved {
  target: "database" | "instance";
  digest: string;
  counts: Record<string, number>;
  movedTo: string | null;
  oldCopyRemovedBy: string;
}

const nf = new Intl.NumberFormat("en-IN");
const NAMES: Record<string, string> = {
  requestsLast24h: "Requests, last 24 hours",
  people: "People",
  rows: "Entries",
  bytes: "Data",
};

function Usage() {
  const { boot } = useWorkspace();
  const m = boot.meter;
  if (!m) return null;
  return (
    <Section title="Free tier" label="Usage">
      {m.state === "OK" ? (
        <p className="text-muted-foreground">Well within the free tier.</p>
      ) : null}
      {m.state === "WATCH" ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            You have used more than 70 percent of the free allowance in one measure.
          </AlertDescription>
        </Alert>
      ) : null}
      {m.state === "ASK" ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            You are close to a free limit. Moving to a database of your own takes a few steps, and
            you can do it whenever you like below.
          </AlertDescription>
        </Alert>
      ) : null}
      {m.state === "OVER" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            You have reached a free limit
            {m.graceEndsOn
              ? `. New entries pause after ${date(m.graceEndsOn)} (${GRACE_DAYS} days of grace)`
              : ""}
            . Reading and exporting always work.
          </AlertDescription>
        </Alert>
      ) : null}
      {(Object.keys(m.usage) as (keyof typeof m.usage)[]).map((k) => {
        const pct = Math.min(100, Math.round((m.ratios[k] ?? 0) * 100));
        const amount = k === "bytes" ? bytesWords(m.usage[k]) : nf.format(m.usage[k]);
        return (
          <Progress
            key={k}
            value={pct}
            className={
              pct >= 100
                ? "[&_[data-slot=progress-indicator]]:bg-destructive"
                : pct >= 70
                  ? "[&_[data-slot=progress-indicator]]:bg-warning"
                  : undefined
            }
          >
            <ProgressLabel>{NAMES[k]}</ProgressLabel>
            <ProgressValue>{() => `${amount} · ${pct}% of the free allowance`}</ProgressValue>
          </Progress>
        );
      })}
      {m.state === "OK" ? (
        <p className="text-sm text-muted-foreground">
          The meter warns you well before anything stops.
        </p>
      ) : null}
    </Section>
  );
}

/**
 * Near a free limit, the first thing offered is handing older months over, which frees room without leaving
 * the place; moving to somewhere of your own comes after it.
 */
function ArchiveBanner() {
  const ws = useWorkspace();
  const state = ws.boot.meter?.state;
  const near = state === "WATCH" || state === "ASK" || state === "OVER";
  const res = useLoad(
    () => (near ? getJson<Retention>(`${ws.api}/retention`) : Promise.resolve(null)),
    [ws.api, near],
  );
  const r = res.data;
  if (!near || !r?.eligibleThrough) return null;
  return (
    <Section title="Archive older months">
      <Alert>
        <ArchiveIcon aria-hidden="true" />
        <AlertDescription>
          Everything through {monthWords(r.eligibleThrough)} can be handed over to you as a backup
          {r.span ? `, which frees about ${bytesWords(r.span.estimatedBytes)}` : ""}. It is the
          quickest way to get well inside the free allowance again.
        </AlertDescription>
      </Alert>
      <div>
        <Link href={`${ws.base}/books/older`} className={buttonVariants()}>
          Archive older months
        </Link>
      </div>
    </Section>
  );
}

const moveSchema = (kind: "database" | "instance") =>
  z.object({
    url: z
      .string()
      .trim()
      .min(1, kind === "database" ? "Enter the connection string" : "Enter the address"),
    token:
      kind === "instance"
        ? z.string().trim().min(24, "The token is at least 24 characters")
        : z.string(),
    track: z.boolean(),
  });

function Move() {
  const ws = useWorkspace();
  const [kind, setKind] = useState<"database" | "instance">("database");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Moved | null>(null);
  const form = useAppForm(moveSchema(kind), { url: "", token: "", track: false });
  const [url, token, track] = form.watch(["url", "token", "track"]);

  // What was checked is what is moved: change anything and the check is to be done again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the things the check was made with
  useEffect(() => setPreview(null), [kind, url, token, track]);

  /** A kitchen without money may become one that tracks money when it is made again on an instance of your own. */
  const target = () => {
    const v = form.getValues();
    return kind === "database"
      ? { kind, url: v.url.trim() }
      : {
          kind,
          url: v.url.trim(),
          token: v.token.trim(),
          ...(!ws.money && v.track ? { moneyEnabled: true } : {}),
        };
  };

  if (done)
    return (
      <div role="region" aria-label="Moved" className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Moved</h3>
        <Alert role="status">
          <CircleCheckIcon aria-hidden="true" />
          <AlertDescription>
            {done.target === "database"
              ? "Your kitchen now lives in your own database, and is served from there."
              : "Your kitchen now lives on your own instance."}
          </AlertDescription>
        </Alert>
        <p>
          {ws.money
            ? "Everything was copied and every statement was recomputed from the raw entries and matched to the paisa."
            : "Everything was copied and every month was counted again from the raw entries and matched, meal for meal."}{" "}
          Checksum <code className="text-sm">{done.digest.slice(0, 16)}…</code>
        </p>
        <p className="text-muted-foreground">
          The old copy stays read-only until {date(done.oldCopyRemovedBy.slice(0, 10))}, then it is
          removed.
        </p>
        {done.movedTo ? (
          <div>
            <a href={done.movedTo} className={buttonVariants()}>
              Open it at the new address
            </a>
          </div>
        ) : null}
      </div>
    );

  return (
    <div role="region" aria-label="Move" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">Move to a place of your own</h3>
        <p className="text-sm text-muted-foreground">
          Nothing changes here until the copy has been checked. Everyone signs in as before, with
          the same email. This copy stays read-only for seven days, in case you change your mind.
        </p>
      </div>
      <ToggleGroup
        aria-label="Where to"
        variant="outline"
        value={[kind]}
        onValueChange={(v) => {
          const next = v[0];
          if (next === "database" || next === "instance") {
            setKind(next);
            form.clearErrors();
          }
        }}
      >
        <ToggleGroupItem value="database">My own database</ToggleGroupItem>
        <ToggleGroupItem value="instance">My own instance</ToggleGroupItem>
      </ToggleGroup>
      <AppForm
        form={form}
        className="max-w-lg"
        onSubmit={async () => {
          setPreview(await postJson<Preview>(`${ws.api}/move/preview`, target()));
        }}
      >
        <FormField
          name="url"
          label={
            kind === "database"
              ? "Connection string of an empty Postgres"
              : "Address of your instance"
          }
          description={
            kind === "database"
              ? "postgres://user:password@host/database?sslmode=require"
              : "https://kitchen.example.org"
          }
          required
        >
          {(f) => <Input {...f} autoComplete="off" spellCheck={false} />}
        </FormField>
        {kind === "instance" && !ws.money ? (
          <Field orientation="horizontal">
            <Checkbox
              id="move-track"
              checked={track}
              onCheckedChange={(on) => form.setValue("track", on === true, { shouldDirty: true })}
            />
            <FieldLabel htmlFor="move-track" className="font-normal">
              Track money in the new kitchen. It arrives with no prices, and you add them there to
              start billing. This kitchen stays as it is.
            </FieldLabel>
          </Field>
        ) : null}
        {kind === "instance" ? (
          <FormField
            name="token"
            label="Token"
            description="The migration token set on that instance."
            required
          >
            {(f) => <Input {...f} type="password" autoComplete="off" />}
          </FormField>
        ) : null}
        <div>
          <SubmitButton busy="Checking…" disabled={!ws.writable}>
            Check it first
          </SubmitButton>
        </div>
      </AppForm>

      {preview ? (
        preview.ok ? (
          <div className="flex flex-col gap-3">
            <Alert role="status">
              <CircleCheckIcon aria-hidden="true" />
              <AlertDescription>It will work. Nothing has been changed.</AlertDescription>
            </Alert>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {preview.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-sm text-muted-foreground">
              {Object.entries(preview.counts)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${k.replace(/_/g, " ")} ${nf.format(n)}`)
                .join(" · ")}
            </p>
            <div>
              <ConfirmAction
                level="typed"
                trigger={
                  <Button type="button" variant="destructive" className={SOLID_DESTRUCTIVE}>
                    Move now
                  </Button>
                }
                title="Move this kitchen?"
                description="Everyone signs in as before. This copy stays read-only for seven days, then it is removed."
                phrase={ws.slug}
                confirmLabel="Move now"
                cancelLabel="Not yet"
                onConfirm={async () => {
                  const r = await postJson<Moved>(`${ws.api}/move`, {
                    target: target(),
                    confirm: ws.slug,
                  });
                  setDone(r);
                  toast.success("Moved.");
                  ws.reload();
                }}
              />
            </div>
          </div>
        ) : (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <ul className="flex flex-col gap-1">
                {preview.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )
      ) : null}
    </div>
  );
}

function Export() {
  const ws = useWorkspace();
  const act = useRun();
  return (
    <Section
      title="Take a copy"
      label="Export"
      description="Everything in this kitchen, in an open format, with a checksum. It works at any time, including when you are over the limit."
    >
      <ActionProblem error={act.error} />
      <div>
        <Button
          type="button"
          variant="outline"
          loading={act.busy}
          loadingText="Preparing the copy…"
          onClick={() =>
            void act.run(async () => {
              const res = await fetch(`${ws.api}/export`, { credentials: "same-origin" });
              if (!res.ok) throw new Error("The export could not be made. Try again.");
              saveBlob(await res.blob(), `${ws.slug}.alimentation.json`);
            })
          }
        >
          <DownloadIcon aria-hidden="true" data-icon="inline-start" />
          Download everything (JSON)
        </Button>
      </div>
    </Section>
  );
}

function Wipe() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const [receipt, setReceipt] = useState<string | null>(null);
  if (receipt)
    return (
      <div role="region" aria-label="Deleted" className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Deleted</h3>
        <Alert role="status">
          <CircleCheckIcon aria-hidden="true" />
          <AlertDescription>
            The keys are destroyed and the kitchen is gone. Nothing of it can be read.
          </AlertDescription>
        </Alert>
        <p>
          If this was your only kitchen, your sign-in record here was removed too. Keep this
          receipt:{" "}
          <a href={`/r/${receipt}`} className="text-primary underline underline-offset-4">
            /r/{receipt.slice(0, 8)}…
          </a>
          . It names no one.
        </p>
        <div>
          <Button type="button" onClick={() => navigate("/app")}>
            Back to your kitchens
          </Button>
        </div>
      </div>
    );
  return (
    <div role="region" aria-label="Delete" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Delete everything</h3>
      <p>
        The keys are destroyed first, so from that moment nothing in this kitchen can be read by
        anyone, including us. Then the database is removed, then every record of who was in it. This
        cannot be undone.
      </p>
      <p className="text-sm text-muted-foreground">
        Take a copy first if you may want it. Copies you have already downloaded are yours and are
        not touched.
      </p>
      <div>
        <ConfirmAction
          level="typed"
          trigger={
            <Button
              type="button"
              variant="destructive"
              className={SOLID_DESTRUCTIVE}
              disabled={!ws.writable}
            >
              Delete this kitchen
            </Button>
          }
          title="Delete this kitchen for good?"
          description="Nothing in it can be read afterwards, by anyone. This cannot be undone."
          phrase={ws.slug}
          confirmLabel="Delete for good"
          cancelLabel="Keep it"
          onConfirm={async () => {
            const r = await postJson<{
              done: boolean;
              receipt?: { workspaceId: string };
              retry?: string;
            }>(`${ws.api}/wipe`, { confirm: ws.slug });
            if (r.done && r.receipt) setReceipt(r.receipt.workspaceId);
            else throw new Error(r.retry ?? "Started. The rest is removed shortly.");
          }}
        />
      </div>
    </div>
  );
}

export function YourData() {
  const ws = useWorkspace();
  const active = ws.boot.workspace.state === "ACTIVE";
  return (
    <>
      <PageHeader
        title="Your data"
        description={`${ws.boot.workspace.name} · /w/${ws.slug}. This is yours: take it, move it, or delete it.`}
      />
      <div className="flex flex-col gap-6">
        <Usage />
        {active ? <ArchiveBanner /> : null}
        <Export />
        {active ? <HeadOffice /> : null}
        <AgentKeys />
        <Section
          title="Danger zone"
          className="ring-destructive/40"
          description="These change where the kitchen lives, or remove it. Each one asks you to type the kitchen's address to confirm."
        >
          {active ? <Move /> : null}
          {active ? <hr className="border-border" /> : null}
          <Wipe />
        </Section>
      </div>
    </>
  );
}
