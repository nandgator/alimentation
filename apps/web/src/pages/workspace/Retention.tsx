import { describeCut } from "@alimentation/core";
import { useState } from "react";
import { getJson, postFile, postForFile, postJson } from "../../api.ts";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  Field,
  Form,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../components/ui.tsx";
import { plural } from "../../format.ts";
import {
  blockerWords,
  bytesWords,
  monthWords,
  type Retention as Status,
  stepOf,
  typedMatches,
} from "../../retention.ts";
import { useWorkspace } from "./context.tsx";

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
    <section className="card stack" aria-label="Handed over">
      <h2>Handed over</h2>
      <div className="banner good" role="status">
        Everything through {monthWords(done.throughMonth)} has been removed from this kitchen.
        {ws.money
          ? " Every later bill was worked out again and came out the same, to the paisa."
          : " Every later month was counted again and came out the same, meal for meal."}
      </div>
      {ws.money && arrears > 0 ? (
        <p>
          {plural(arrears, "person", "people")} who owed something start{arrears === 1 ? "s" : ""}{" "}
          the first live month with that balance already counted.
        </p>
      ) : null}
      <p className="muted small">
        Checksum <code>{done.checksum}</code>. Keep the file you saved: it is the only copy.
        {done.compacted ? "" : " The space will be freed shortly."}
      </p>
    </section>
  );
}

function Window({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const [months, setMonths] = useState(String(status.window.keepMonths));
  const act = useAction();
  const n = Number(months);
  const valid = Number.isInteger(n) && n >= status.window.min && n <= status.window.max;
  return (
    <section className="card stack" aria-label="How long months stay">
      <h2>How long months stay</h2>
      <p className="muted">
        The last {status.window.keepMonths} months always stay, as does the current one. Older
        closed months can be handed over to you as a backup.
      </p>
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            await postJson(`${ws.api}/retention/window`, { months: n });
            toast("Saved.");
            reload();
          })
        }
      >
        <Field
          label="Months to keep"
          id="keepmonths"
          hint={`Between ${status.window.min} and ${status.window.max}. Usually ${status.window.default}.`}
        >
          <input
            id="keepmonths"
            type="number"
            inputMode="numeric"
            min={status.window.min}
            max={status.window.max}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </Field>
        <div>
          <Button
            variant="outline"
            type="submit"
            disabled={act.busy || !valid || !ws.writable || n === status.window.keepMonths}
          >
            Save
          </Button>
        </div>
      </Form>
    </section>
  );
}

function Choose({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const newest = status.eligibleThrough;
  const [picked, setPicked] = useState<string | null>(null);
  const through = picked ?? newest;
  const stuck = status.blockers;
  // Too much for one hand-over: an earlier month may be chosen, and the rest done in steps.
  const choices = newest ? ws.boot.months.filter((m) => m <= newest) : [];
  return (
    <section className="card stack" aria-label="Hand over">
      <h2>Hand over older months</h2>
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
            <p className="muted">
              {status.peopleWithArrears > 0
                ? `${plural(status.peopleWithArrears, "person", "people")} owe${status.peopleWithArrears === 1 ? "s" : ""} something for those months. That balance is carried to the first live month, to the paisa, so nobody’s bill changes.`
                : "Nobody owes anything for those months, so nothing needs carrying forward. Bills after them do not change."}
            </p>
          ) : (
            <p className="muted">
              Meal counts after those months do not change. Nothing needs carrying forward.
            </p>
          )}
          {status.span?.tooLarge ? (
            <div className="banner warn" role="status">
              Those months hold more than one hand-over takes ({nf.format(status.span.maxRows)}{" "}
              records). Choose an earlier month and hand them over in steps.
            </div>
          ) : null}
          {status.span?.tooLarge ? (
            <Field label="Hand over everything through" id="throughmonth">
              <select
                id="throughmonth"
                value={through ?? ""}
                onChange={(e) => setPicked(e.target.value)}
              >
                {choices.map((m) => (
                  <option key={m} value={m}>
                    {monthWords(m)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div>
            <Button
              variant="accent"
              type="button"
              disabled={!ws.writable}
              onClick={() => setAsking(true)}
            >
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
        <div className="stack" style={{ ["--gap" as string]: "8px" }}>
          <h3>What stands in the way of {monthWords(status.newestCut)}</h3>
          <ul className="plain-list stack" style={{ ["--gap" as string]: "4px" }}>
            {stuck.map((b) => (
              <li key={`${b.month}${b.code}`}>{blockerWords(b, ws.nameOf)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Download everything through ${through ? monthWords(through) : ""}`}
      >
        <p>{KEEP_THIS}</p>
        <p className="muted small">{HONEST_LIMIT}</p>
        <p className="muted small">
          The file stays valid for 24 hours. After you have saved it you upload it back here, and
          only then are the months removed.
        </p>
        <Problem error={act.error} />
        <div className="row">
          <Button
            variant="accent"
            type="button"
            disabled={act.busy || !through}
            onClick={() =>
              void act.run(async () => {
                if (!through) return;
                const got = await postForFile(`${ws.api}/retention/prepare`, { through });
                const url = URL.createObjectURL(got.blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = got.filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                setAsking(false);
                reload();
              })
            }
          >
            Download and keep the file
          </Button>
          <Button variant="outline" type="button" onClick={() => setAsking(false)}>
            Not now
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function Upload({ status, reload }: { status: Status; reload: () => void }) {
  const ws = useWorkspace();
  const offer = status.offer;
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  const drop = useAction();
  if (!offer) return null;
  return (
    <section className="card stack" aria-label="Upload the saved file">
      <h2>Upload the file you saved</h2>
      <p>
        The months through {monthWords(offer.throughMonth)} have been downloaded (checksum{" "}
        <code>{offer.checksum}</code>). Upload that same file here. Nothing is removed until you do,
        and then once more when you type the month.
      </p>
      <p className="muted small">
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
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            if (!file) return;
            await postFile(`${ws.api}/retention/confirm`, file);
            toast("The file is the right one.");
            reload();
          })
        }
      >
        <Field label="The saved file" id="slicefile">
          <input
            id="slicefile"
            type="file"
            accept=".json,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <div className="row">
          <Button variant="accent" type="submit" disabled={act.busy || !file || !ws.writable}>
            Check the file
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={drop.busy}
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
      </Form>
      <Problem error={drop.error} />
    </section>
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
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const drop = useAction();
  if (!offer) return null;
  return (
    <section className="card stack" aria-label="Remove the months">
      <h2>Remove the months</h2>
      <div className="banner good" role="status">
        That is the file that was downloaded, intact. The records in it are as they were.
      </div>
      <p>
        Everything through <strong>{monthWords(offer.throughMonth)}</strong> will be removed from
        this kitchen. {KEEP_THIS}
      </p>
      <div className="row">
        <Button
          variant="destructive"
          type="button"
          disabled={!ws.writable}
          onClick={() => setAsking(true)}
        >
          Remove these months
        </Button>
        <Button
          variant="outline"
          type="button"
          disabled={drop.busy}
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
      <Problem error={drop.error} />
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Remove everything through ${monthWords(offer.throughMonth)}`}
      >
        <p>{KEEP_THIS}</p>
        <p className="muted small">
          First every later month is worked out again with what is removed gone. If anything differs
          by a paisa, nothing is removed.
        </p>
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const out = await postJson<Applied>(`${ws.api}/retention/apply`, {
                offerId: offer.id,
                typedMonth: offer.throughMonth,
              });
              setAsking(false);
              onDone(out, status.peopleWithArrears);
              ws.reload();
            })
          }
        >
          <Field label={`Type ${monthWords(offer.throughMonth)} to confirm`} id="typedmonth">
            <input
              id="typedmonth"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="row">
            <Button
              variant="destructive"
              type="submit"
              disabled={act.busy || !typedMatches(typed, offer.throughMonth)}
            >
              Remove for good
            </Button>
            <Button variant="outline" type="button" onClick={() => setAsking(false)}>
              Not now
            </Button>
          </div>
        </Form>
      </Dialog>
    </section>
  );
}

export function Retention() {
  const ws = useWorkspace();
  const res = useLoad(() => getJson<Status>(`${ws.api}/retention`), [ws.api]);
  const [done, setDone] = useState<{ applied: Applied; arrears: number } | null>(null);
  const status = res.data;
  const step = stepOf(status?.offer ?? null);
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Older months"
        lead="Months older than the window can be handed over to you as a file, then removed from here. Balances carry over to the paisa."
      />
      <Problem error={res.error} />
      {res.loading && !status ? <Spinner /> : null}
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
            <section className="card stack" aria-label="Removing">
              <h2>Removing the months</h2>
              <p role="status">
                The months are being removed. The kitchen is read-only for a moment.
              </p>
              <div>
                <Button variant="outline" type="button" onClick={res.reload}>
                  Look again
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      {status ? (
        <section className="card stack" aria-label="Handed over so far">
          <h2>Handed over so far</h2>
          {status.cuts.length === 0 ? (
            <p className="muted">Nothing yet. Every month is still kept here.</p>
          ) : (
            <ol className="history">
              {[...status.cuts].reverse().map((c) => (
                <li key={c.throughMonth}>
                  <span>
                    {describeCut(
                      { throughMonth: c.throughMonth, checksum: c.checksum, at: c.cutAt },
                      ws.boot.workspace.timeZone,
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
      {status && step === "choose" ? <Window status={status} reload={res.reload} /> : null}
      <p className="muted small">{HONEST_LIMIT}</p>
    </div>
  );
}
