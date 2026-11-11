import {
  type PersonFieldChange,
  type PersonImportMode,
  type PersonImportResult,
  peopleCsvTemplate,
} from "@alimentation/core";
import { useState } from "react";
import { postCsv } from "../../api.ts";
import { Chip, Dialog, Field, Problem, toast, useAction } from "../../components/ui.tsx";
import { useWorkspace } from "./context.tsx";

const EXAMPLE = "externalKey,name,role,contact,activeFrom,activeTo";
const ACTION_WORDS = {
  create: ["Add", "good"],
  update: ["Change", "warn"],
  unchanged: ["No change", undefined],
  error: ["Refused", "bad"],
} as const;
const FIELD_WORDS: Record<PersonFieldChange["field"], string> = {
  role: "role",
  name: "name",
  contact: "contact",
  activeFrom: "eating from",
  activeTo: "until",
};

/** Hands a text to the browser as a file. The mark at the front lets a spreadsheet read the letters right. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const shown = (v: string | null) => (v === null || v === "" ? "nothing" : v);

/** People pasted or read from a file, previewed row by row before anything is written. */
export function ImportPeopleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<PersonImportMode>("merge");
  const [preview, setPreview] = useState<PersonImportResult | null>(null);
  const act = useAction();
  const send = (dryRun: boolean) =>
    postCsv<PersonImportResult>(`${ws.api}/people/import?mode=${mode}&dryRun=${dryRun}`, text);
  const changed = () => {
    setPreview(null);
    act.clear();
  };
  const close = () => {
    setText("");
    setPreview(null);
    act.clear();
    onClose();
  };
  const refused = preview?.summary.error ?? 0;
  const work = preview ? preview.summary.create + preview.summary.update : 0;
  return (
    <Dialog open={open} onClose={close} title="Import people">
      <div className="stack" style={{ ["--gap" as string]: "16px" }}>
        <p className="muted small">
          A file with one person to a row. A row with a key (a room or staff number your kitchen
          already uses) finds the person who has that key and changes them, or adds them if nobody
          does. A row without a key is always added. Nobody is removed or disabled for not being in
          the file, and a role is never changed.
        </p>
        <Field
          label="People"
          id="pimport"
          hint={
            <>
              The first line names the columns: <code>{EXAMPLE}</code>. Only name and role are
              needed. Role is member, supplier or admin.
            </>
          }
        >
          <textarea
            id="pimport"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              changed();
            }}
          />
        </Field>
        <div className="row">
          <Field label="Or choose a file" id="pfile">
            <input
              id="pfile"
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
          <button
            type="button"
            className="btn ghost small"
            onClick={() => downloadCsv("people-template.csv", peopleCsvTemplate())}
          >
            Download a template
          </button>
        </div>
        <fieldset className="stack choices" style={{ ["--gap" as string]: "8px" }}>
          <legend>If a person is already there</legend>
          {(
            [
              [
                "merge",
                "Merge: set what the file gives. A blank cell leaves what is there as it is.",
              ],
              [
                "overwrite",
                "Overwrite: set everything the file gives. A blank contact or date clears it.",
              ],
            ] as const
          ).map(([value, words]) => (
            <label key={value} className="row" style={{ ["--gap" as string]: "var(--space-3)" }}>
              <input
                type="radio"
                name="people-import-mode"
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
              {preview.summary.create} to add, {preview.summary.update} to change,{" "}
              {preview.summary.unchanged} already as in the file, {preview.summary.error} refused.
              {refused > 0 ? " Nothing is added or changed until every row is fixed." : ""}
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
                    <th>Key</th>
                    <th>Name</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.row}-${r.externalKey ?? ""}-${r.action}-${r.message}`}>
                      <td>{r.row}</td>
                      <td>{r.externalKey ?? "-"}</td>
                      <td>{r.name}</td>
                      <td>
                        <Chip tone={ACTION_WORDS[r.action][1]}>{ACTION_WORDS[r.action][0]}</Chip>{" "}
                        {r.message}
                        {r.action === "update"
                          ? r.diff.map((d) => (
                              <div key={d.field} className="muted small">
                                {FIELD_WORDS[d.field]}: {shown(d.from)} to {shown(d.to)}
                              </div>
                            ))
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <Problem error={act.error} />
        <div className="row">
          <button
            type="button"
            className="btn ghost"
            disabled={act.busy || text.trim() === ""}
            onClick={() =>
              void act.run(async () => {
                setPreview(await send(true));
              })
            }
          >
            Preview
          </button>
          <button
            type="button"
            className="btn"
            disabled={act.busy || !ws.writable || !preview || refused > 0 || work === 0}
            onClick={() =>
              void act.run(async () => {
                const done = await send(false);
                if (!done.committed) {
                  setPreview(done);
                  throw new Error("Nothing was changed, because some rows were refused.");
                }
                toast(`${done.summary.create} added, ${done.summary.update} changed.`);
                close();
                ws.reload();
              })
            }
          >
            Confirm
          </button>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
