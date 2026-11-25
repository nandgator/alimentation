import type { HolidayImportMode, HolidayImportResult } from "@alimentation/core";
import { useState } from "react";
import { api, postJson } from "../../../api.ts";
import { Button } from "../../../components/legacy/button.tsx";
import { Card } from "../../../components/legacy/card.tsx";
import { Input, Textarea } from "../../../components/legacy/input.tsx";
import {
  Chip,
  Dialog,
  Field,
  Form,
  PageHead,
  Problem,
  toast,
  useAction,
} from "../../../components/ui.tsx";
import { date } from "../../../format.ts";
import { useWorkspace } from "../context.tsx";

export function Holidays() {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [day, setDay] = useState(ws.boot.today);
  const [endDay, setEndDay] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [importing, setImporting] = useState(false);
  const act = useAction();
  const list = [...ws.boot.holidays].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead title="Holidays" />
      <Card className="stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const range = endDay !== "" && endDay !== day;
              const made = await postJson<{ ids: string[] }>(
                `${ws.api}/holidays`,
                range ? { name, from: day, to: endDay, confirmed } : { name, date: day, confirmed },
              );
              setName("");
              setEndDay("");
              toast(made.ids.length > 1 ? `${made.ids.length} holidays added.` : "Holiday added.");
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Name" id="hname">
              <Input
                id="hname"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Date" id="hdate">
              <Input
                id="hdate"
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="End date (optional)"
            id="hend"
            hint="For several days in a row: one holiday is added for each day from the date to this one, weekends too."
          >
            <Input
              id="hend"
              type="date"
              min={day}
              value={endDay}
              onChange={(e) => setEndDay(e.target.value)}
            />
          </Field>
          <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmed (a meal is not served and not billed)
          </label>
          <div className="row">
            <Button type="submit" disabled={act.busy || !ws.writable}>
              Add
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={!ws.writable}
              onClick={() => setImporting(true)}
            >
              Import
            </Button>
          </div>
        </Form>
      </Card>
      <ImportHolidaysDialog open={importing} onClose={() => setImporting(false)} />
      {list.length === 0 ? <p className="muted">No holidays yet.</p> : null}
      {list.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id}>
                  <td>{date(h.date)}</td>
                  <td>{h.name}</td>
                  <td>
                    <Chip tone={h.confirmed ? "good" : "warn"}>
                      {h.confirmed ? "Confirmed" : "Tentative"}
                    </Chip>
                  </td>
                  <td>
                    <div className="row" style={{ ["--gap" as string]: "var(--space-2)" }}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .patch(`${ws.api}/holidays/${h.id}`, { confirmed: !h.confirmed })
                            .then(ws.reload, (e: Error) => toast(e.message, "bad"))
                        }
                      >
                        {h.confirmed ? "Make tentative" : "Confirm"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .del(`${ws.api}/holidays/${h.id}`)
                            .then(ws.reload, (e: Error) => toast(e.message, "bad"))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const IMPORT_EXAMPLE = "name,from,to,location,confirmed\nDiwali break,2026-11-08,2026-11-11,,yes";
const ACTION_WORDS = {
  create: ["Add", "good"],
  replace: ["Replace", "warn"],
  skip: ["Skip", undefined],
  error: ["Refused", "bad"],
} as const;

/** Holidays pasted or read from a file, previewed row by row before anything is written. */
function ImportHolidaysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<HolidayImportMode>("merge");
  const [partial, setPartial] = useState(false);
  const [preview, setPreview] = useState<HolidayImportResult | null>(null);
  const act = useAction();
  const body = (dryRun: boolean) => ({ mode, dryRun, partial, csv: text });
  const changed = () => setPreview(null);
  const refused = preview?.summary.error ?? 0;
  const close = () => {
    setText("");
    setPreview(null);
    setPartial(false);
    act.clear();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Import holidays">
      <div className="stack" style={{ ["--gap" as string]: "16px" }}>
        <Field
          label="Holidays"
          id="himport"
          hint={
            <>
              One holiday to a line, the first line naming the columns: name, from, to, location,
              confirmed. Only name and from (or date) are needed. For example:{" "}
              <code>{IMPORT_EXAMPLE.replace("\n", " / ")}</code>
            </>
          }
        >
          <Textarea
            id="himport"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field label="Or choose a file" id="hfile">
          <input
            id="hfile"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((t) => {
                setText(t);
                changed();
              });
            }}
          />
        </Field>
        <fieldset className="stack choices" style={{ ["--gap" as string]: "8px" }}>
          <legend>If a day already has a holiday</legend>
          {(
            [
              [
                "merge",
                "Keep what is there and add the new ones (the same day, name and place is skipped).",
              ],
              [
                "overwrite",
                "Replace what is there on the days in the list. Other days are left alone.",
              ],
            ] as const
          ).map(([value, words]) => (
            <label key={value} className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  changed();
                }}
              />
              {words}
            </label>
          ))}
        </fieldset>
        {preview ? (
          <div className="stack" style={{ ["--gap" as string]: "8px" }}>
            <p>
              {preview.summary.create} to add, {preview.summary.replace} to replace
              {preview.summary.removed > 0 ? ` (taking away ${preview.summary.removed})` : ""},{" "}
              {preview.summary.skip} skipped, {preview.summary.error} refused.
            </p>
            <div
              className="tablewrap"
              tabIndex={0}
              role="region"
              aria-label="Preview; scrolls sideways when it is wider than the screen"
            >
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Date</th>
                    <th>Name</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.row}-${r.date ?? ""}-${r.action}-${r.name}-${r.message}`}>
                      <td>{r.row}</td>
                      <td>{r.date ? date(r.date) : ""}</td>
                      <td>{r.name}</td>
                      <td>
                        <Chip tone={ACTION_WORDS[r.action][1]}>{ACTION_WORDS[r.action][0]}</Chip>{" "}
                        {r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {refused > 0 ? (
              <label className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(e) => setPartial(e.target.checked)}
                />
                Add the rest and leave out the refused rows (otherwise nothing is added)
              </label>
            ) : null}
          </div>
        ) : null}
        <Problem error={act.error} />
        <div className="row">
          <Button
            variant="outline"
            type="button"
            disabled={act.busy || text.trim() === ""}
            onClick={() =>
              void act.run(async () => {
                setPreview(
                  await postJson<HolidayImportResult>(`${ws.api}/holidays/bulk`, body(true)),
                );
              })
            }
          >
            Preview
          </Button>
          <Button
            type="button"
            disabled={
              act.busy ||
              !ws.writable ||
              !preview ||
              (refused > 0 && !partial) ||
              preview.summary.create + preview.summary.replace === 0
            }
            onClick={() =>
              void act.run(async () => {
                const done = await postJson<HolidayImportResult>(
                  `${ws.api}/holidays/bulk`,
                  body(false),
                );
                if (!done.committed) {
                  setPreview(done);
                  throw new Error("Nothing was added, because some rows were refused.");
                }
                toast(`${done.summary.create + done.summary.replace} holidays added.`);
                close();
                ws.reload();
              })
            }
          >
            Confirm
          </Button>
          <Button variant="outline" type="button" onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
