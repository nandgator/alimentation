import { describeCut } from "@alimentation/core";
import { ArchiveIcon, CircleCheckIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { getJson, postFile, postForFile, postJson } from "@/api";
import {
  AppForm,
  ConfirmAction,
  CountInput,
  FormField,
  PageHeader,
  PageSkeleton,
  SubmitButton,
  toast,
  useAppForm,
} from "@/components/app";
import { SOLID_DESTRUCTIVE } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { plural } from "@/format";
import {
  blockerWords,
  bytesWords,
  monthWords,
  type Retention as Status,
  stepOf,
} from "../../../retention.ts";
import { useWorkspace } from "../context.tsx";
import { ActionProblem, LoadProblem, Section, saveBlob, useLoad, useRun } from "./parts.tsx";

interface Applied {
  throughMonth: string;
  checksum: string;
  counts: Record<string, number>;
  compacted: boolean;
}

const nf = new Intl.NumberFormat("en-IN");

/** The sentence every step repeats: what the file is, and what happens to the records. */
const KEEP_THIS =
  "Keep this file. There is no second copy. Records in these months can no longer be edited or reopened, and payments for them are recorded on the first live month.";

/** The same, for a person who asks what is in it, and what the kitchen can and cannot prove. */
const HONEST_LIMIT =
  "The file holds names and notes in the clear, so whoever keeps it guards it. We can check that you held the exact file, not that you keep it safely.";

function Done({ done, arrears }: { done: Applied; arrears: number }) {
  const ws = useWorkspace();
  return (
    <Section title="Handed over">
      <Alert role="status">
        <CircleCheckIcon aria-hidden="true" />
        <AlertDescription>
          Everything through {monthWords(done.throughMonth)} has been removed from this kitchen.
          {ws.money
            ? " Every later bill was worked out again and came out the same, to the paisa."
            : " Every later month was counted again and came out the same, meal for meal."}
        </AlertDescription>
      </Alert>
      {ws.money && arrears > 0 ? (
        <p>
          {plural(arrears, "person", "people")} who owed something start{arrears === 1 ? "s" : ""}{" "}
          the first live month with that balance already counted.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Checksum <code>{done.checksum}</code>. Keep the file you saved: it is the only copy.
        {done.compacted ? "" : " The space will be freed shortly."}
      </p>
    </Section>
  );
}

function Window({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const { min, max, keepMonths } = status.window;
  const schema = z.object({
    months: z
      .string()
      .refine(
        (v) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max,
        `Enter a whole number from ${min} to ${max}`,
      ),
  });
  const form = useAppForm(schema, { months: String(keepMonths) });
  const changed = Number(form.watch("months")) !== keepMonths;
  return (
    <Section
      title="How long months stay"
      description={`The last ${keepMonths} months always stay, as does the current one. Older closed months can be handed over to you as a backup.`}
    >
      <AppForm
        form={form}
        className="max-w-sm"
        onSubmit={async (v) => {
          await postJson(`${ws.api}/retention/window`, { months: Number(v.months) });
          toast.success("Saved.");
          reload();
        }}
      >
        <FormField
          name="months"
          label="Months to keep"
          description={`Between ${min} and ${max}. Usually ${status.window.default}.`}
        >
          {(f) => <CountInput {...f} />}
        </FormField>
        <div>
          <SubmitButton disabled={!ws.writable || !changed}>Save</SubmitButton>
        </div>
      </AppForm>
    </Section>
  );
}

/** Every month the kitchen still holds, and where each stands: this is the whole list the hand-over works from. */
function Months({ status }: { status: Status }) {
  const ws = useWorkspace();
  const blocked = new Set(status.blockers.map((b) => b.month as string));
  const held = [...ws.boot.months].reverse();
  const stateOf = (m: string) =>
    status.eligibleThrough && m <= status.eligibleThrough
      ? { icon: ArchiveIcon, text: "Can be handed over" }
      : blocked.has(m)
        ? { icon: LockIcon, text: "Something stands in the way" }
        : { icon: LockIcon, text: m >= ws.boot.currentMonth ? "Current month" : "Stays here" };
  if (held.length === 0) return null;
  return (
    <Section title="Months kept here" description="Where each month stands for a hand-over.">
      <ul
        className="max-h-72 divide-y overflow-y-auto rounded-lg border"
        // A list that scrolls can be reached and scrolled from the keyboard.
        tabIndex={0}
        aria-label="Months"
      >
        {held.map((m) => {
          const s = stateOf(m);
          const Icon = s.icon;
          return (
            <li key={m} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{monthWords(m)}</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Icon aria-hidden="true" className="size-4" />
                {s.text}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Choose({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const [asking, setAsking] = useState(false);
  const act = useRun();
  const newest = status.eligibleThrough;
  const [picked, setPicked] = useState<string | null>(null);
  const through = picked ?? newest;
  const stuck = status.blockers;
  // Too much for one hand-over: an earlier month may be chosen, and the rest done in steps.
  const choices = newest ? ws.boot.months.filter((m) => m <= newest) : [];
  return (
    <Section title="Hand over older months" label="Hand over">
      {newest ? (
        <>
          <p>
            Everything through <strong>{monthWords(newest)}</strong> can be handed over now.
            {status.span && through === newest ? (
              <>
                {" "}
                That is {plural(status.span.rows, "record")} and about{" "}
                {bytesWords(status.span.estimatedBytes)} freed.
              </>
            ) : null}
          </p>
          {ws.money ? (
            <p className="text-muted-foreground">
              {status.peopleWithArrears > 0
                ? `${plural(status.peopleWithArrears, "person", "people")} owe${status.peopleWithArrears === 1 ? "s" : ""} something for those months. That balance is carried to the first live month, to the paisa, so nobody’s bill changes.`
                : "Nobody owes anything for those months, so nothing needs carrying forward. Bills after them do not change."}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Meal counts after those months do not change. Nothing needs carrying forward.
            </p>
          )}
          {status.span?.tooLarge ? (
            <Alert role="status">
              <AlertDescription>
                Those months hold more than one hand-over takes ({nf.format(status.span.maxRows)}{" "}
                records). Choose an earlier month and hand them over in steps.
              </AlertDescription>
            </Alert>
          ) : null}
          {status.span?.tooLarge ? (
            <div className="flex max-w-sm flex-col gap-1.5">
              <label htmlFor="throughmonth" className="text-sm font-medium">
                Hand over everything through
              </label>
              <NativeSelect
                id="throughmonth"
                className="w-full"
                value={through ?? ""}
                onChange={(e) => setPicked(e.target.value)}
              >
                {choices.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {monthWords(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div>
            <Button type="button" disabled={!ws.writable} onClick={() => setAsking(true)}>
              Download these months
            </Button>
          </div>
        </>
      ) : (
        <p>
          {status.archivedThrough
            ? "Nothing more can be handed over yet."
            : `Nothing is old enough yet. The last ${status.window.keepMonths} months always stay.`}
        </p>
      )}
      {stuck.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">What stands in the way of {monthWords(status.newestCut)}</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {stuck.map((b) => (
              <li key={`${b.month}${b.code}`}>{blockerWords(b, ws.nameOf)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={asking}
        onOpenChange={(o) => {
          if (!act.busy) {
            setAsking(o);
            if (!o) act.clear();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Download everything through {through ? monthWords(through) : ""}
            </DialogTitle>
            <DialogDescription>{KEEP_THIS}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{HONEST_LIMIT}</p>
          <p className="text-sm text-muted-foreground">
            The file stays valid for 24 hours. After you have saved it you upload it back here, and
            only then are the months removed.
          </p>
          <ActionProblem error={act.error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={act.busy}
              onClick={() => setAsking(false)}
            >
              Not now
            </Button>
            <Button
              type="button"
              loading={act.busy}
              loadingText="Preparing the file…"
              disabled={!through}
              onClick={() =>
                void act.run(async () => {
                  if (!through) return;
                  const got = await postForFile(`${ws.api}/retention/prepare`, { through });
                  saveBlob(got.blob, got.filename);
                  setAsking(false);
                  reload();
                })
              }
            >
              Download and keep the file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

const fileSchema = z.object({
  file: z.any().refine((f) => f instanceof File, "Choose the file you saved"),
});

function Upload({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const offer = status.offer;
  const drop = useRun();
  const form = useAppForm(fileSchema, { file: null });
  if (!offer) return null;
  return (
    <Section title="Upload the file you saved" label="Upload the saved file">
      <p>
        The months through {monthWords(offer.throughMonth)} have been downloaded (checksum{" "}
        <code>{offer.checksum}</code>). Upload that same file here. Nothing is removed until you do,
        and then once more when you type the month.
      </p>
      <p className="text-sm text-muted-foreground">
        The offer ends on{" "}
        {new Intl.DateTimeFormat("en-GB", {
          timeZone: ws.boot.workspace.timeZone,
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(offer.expiresAt))}
        .
      </p>
      <AppForm
        form={form}
        className="max-w-md"
        onSubmit={async (v) => {
          await postFile(`${ws.api}/retention/confirm`, v.file as File);
          toast.success("The file is the right one.");
          reload();
        }}
      >
        <FormField name="file" label="The saved file">
          {(f) => (
            <Input
              id={f.id}
              name={f.name}
              ref={f.ref}
              type="file"
              accept=".json,application/json"
              aria-invalid={f["aria-invalid"]}
              aria-describedby={f["aria-describedby"]}
              onBlur={f.onBlur}
              onChange={(e) => f.onChange(e.target.files?.[0] ?? null)}
            />
          )}
        </FormField>
        <div className="flex flex-wrap gap-2">
          <SubmitButton busy="Checking…" disabled={!ws.writable}>
            Check the file
          </SubmitButton>
          <Button
            type="button"
            variant="outline"
            loading={drop.busy}
            onClick={() =>
              void drop.run(async () => {
                await postJson(`${ws.api}/retention/cancel`, { offerId: offer.id });
                reload();
              })
            }
          >
            Start again
          </Button>
        </div>
      </AppForm>
      <ActionProblem error={drop.error} />
    </Section>
  );
}

function Apply({
  status,
  reload,
  onDone,
}: {
  status: Status;
  reload: () => void;
  onDone: (a: Applied, arrears: number) => void;
}) {
  const ws = useWorkspace();
  const offer = status.offer;
  const drop = useRun();
  if (!offer) return null;
  const through = monthWords(offer.throughMonth);
  return (
    <Section title="Remove the months">
      <Alert role="status">
        <CircleCheckIcon aria-hidden="true" />
        <AlertDescription>
          That is the file that was downloaded, intact. The records in it are as they were.
        </AlertDescription>
      </Alert>
      <p>
        Everything through <strong>{through}</strong> will be removed from this kitchen. {KEEP_THIS}
      </p>
      <div className="flex flex-wrap gap-2">
        <ConfirmAction
          level="typed"
          trigger={
            <Button
              type="button"
              variant="destructive"
              className={SOLID_DESTRUCTIVE}
              disabled={!ws.writable}
            >
              Remove these months
            </Button>
          }
          title={`Remove everything through ${through}`}
          description={
            <>
              {KEEP_THIS} First every later month is worked out again with what is removed gone. If
              anything differs by a paisa, nothing is removed.
            </>
          }
          phrase={through}
          confirmLabel="Remove for good"
          cancelLabel="Not now"
          onConfirm={async () => {
            const out = await postJson<Applied>(`${ws.api}/retention/apply`, {
              offerId: offer.id,
              typedMonth: offer.throughMonth,
            });
            onDone(out, status.peopleWithArrears);
            ws.reload();
          }}
        />
        <Button
          type="button"
          variant="outline"
          loading={drop.busy}
          onClick={() =>
            void drop.run(async () => {
              await postJson(`${ws.api}/retention/cancel`, { offerId: offer.id });
              reload();
            })
          }
        >
          Start again
        </Button>
      </div>
      <ActionProblem error={drop.error} />
    </Section>
  );
}

export function Retention() {
  const ws = useWorkspace();
  const res = useLoad(() => getJson<Status>(`${ws.api}/retention`), [ws.api]);
  const [done, setDone] = useState<{ applied: Applied; arrears: number } | null>(null);
  const status = res.data;
  const step = stepOf(status?.offer ?? null);
  return (
    <>
      <PageHeader
        title="Older months"
        description="Months older than the window can be handed over to you as a file, then removed from here. Balances carry over to the paisa."
      />
      <LoadProblem error={res.error} onRetry={res.reload} />
      <PageSkeleton loading={res.loading && !status && !res.error} variant="list">
        <div className="flex flex-col gap-6">
          {done ? <Done done={done.applied} arrears={done.arrears} /> : null}
          {status && !done ? (
            <>
              {step === "choose" ? <Choose status={status} reload={res.reload} /> : null}
              {step === "upload" ? <Upload status={status} reload={res.reload} /> : null}
              {step === "apply" ? (
                <Apply
                  status={status}
                  reload={res.reload}
                  onDone={(applied, arrears) => setDone({ applied, arrears })}
                />
              ) : null}
              {step === "running" ? (
                <Section title="Removing the months" label="Removing">
                  <p role="status">
                    The months are being removed. The kitchen is read-only for a moment.
                  </p>
                  <div>
                    <Button type="button" variant="outline" onClick={res.reload}>
                      Look again
                    </Button>
                  </div>
                </Section>
              ) : null}
            </>
          ) : null}
          {status ? (
            <Section title="Handed over so far">
              {status.cuts.length === 0 ? (
                <p className="text-muted-foreground">
                  Nothing yet. Every month is still kept here.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {[...status.cuts].reverse().map((c) => (
                    <li key={c.throughMonth}>
                      {describeCut(
                        { throughMonth: c.throughMonth, checksum: c.checksum, at: c.cutAt },
                        ws.boot.workspace.timeZone,
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          ) : null}
          {status && step === "choose" && !done ? <Months status={status} /> : null}
          {status && step === "choose" ? <Window status={status} reload={res.reload} /> : null}
          <p className="text-sm text-muted-foreground">{HONEST_LIMIT}</p>
        </div>
      </PageSkeleton>
    </>
  );
}
