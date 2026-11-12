import {
  DEFAULT_POLICY,
  dayName,
  must,
  type Policy,
  type PolicyView,
  type Weekday,
} from "@alimentation/core";
import { useState } from "react";
import { getJson, postJson } from "../../api.ts";
import {
  Dialog,
  Field,
  Form,
  PageHead,
  Problem,
  SectionHead,
  toast,
  useAction,
  useLoad,
} from "../../components/ui.tsx";
import { useWorkspace } from "./context.tsx";

const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function PolicyForm({ current, onDone }: { current: PolicyView; onDone: () => void }) {
  const ws = useWorkspace();
  const [p, setP] = useState<PolicyView>(current);
  // The money rules are in the view only for a kitchen that tracks money.
  const full = ws.money ? (p as Policy) : null;
  const [from, setFrom] = useState(ws.boot.today);
  const act = useAction();
  const days = new Set(p.workingDays);
  const close = p.monthClose;
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await postJson(`${ws.api}/policies`, { effectiveFrom: from, doc: p });
          toast("Rules updated.");
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        These rules apply to months starting on or after the date below. Earlier months keep the
        rules they were {ws.money ? "billed" : "counted"} under.
      </p>
      <Field label="Applies from" id="pfrom2">
        <input
          id="pfrom2"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <div className="field">
        <span className="label">Meals are served on</span>
        <div className="row">
          {WEEK.map((d) => (
            <label key={d} className="row" style={{ ["--gap" as string]: "var(--space-1)" }}>
              <input
                type="checkbox"
                checked={days.has(d)}
                onChange={(e) =>
                  setP({
                    ...p,
                    workingDays: e.target.checked
                      ? [...p.workingDays, d].sort()
                      : p.workingDays.filter((x) => x !== d),
                  })
                }
              />
              {dayName(d)}
            </label>
          ))}
        </div>
      </div>
      <div className="pair">
        <Field label="Holidays that cancel a meal" id="pol-h">
          <select
            id="pol-h"
            value={p.holidays.count}
            onChange={(e) =>
              setP({ ...p, holidays: { count: e.target.value as "confirmed" | "all" } })
            }
          >
            <option value="confirmed">Only confirmed holidays</option>
            <option value="all">All listed holidays</option>
          </select>
        </Field>
        {full ? (
          <>
            <Field
              label="Charge on a leave day (%)"
              id="pol-l"
              hint="Share of the day’s meal price."
            >
              <input
                id="pol-l"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={full.leave.chargeBps / 100}
                onChange={(e) =>
                  setP({ ...full, leave: { chargeBps: Math.round(Number(e.target.value) * 100) } })
                }
              />
            </Field>
            <Field
              label="Monthly fee applies from"
              id="pol-e"
              hint="Days with a meal needed in the month; none means no monthly fee."
            >
              <input
                id="pol-e"
                type="number"
                min={0}
                max={31}
                value={full.monthlyFee?.minDays ?? 0}
                onChange={(e) =>
                  setP({
                    ...full,
                    monthlyFee:
                      Number(e.target.value) > 0 ? { minDays: Number(e.target.value) } : null,
                  })
                }
              />
            </Field>
            <Field label="Payments" id="pol-p">
              <select
                id="pol-p"
                value={full.payments}
                onChange={(e) => setP({ ...full, payments: e.target.value as Policy["payments"] })}
              >
                <option value="claim_confirm">Member claims, supplier confirms</option>
                <option value="direct">Recorded directly</option>
              </select>
            </Field>
          </>
        ) : null}
      </div>
      <div className="pair">
        <Field
          label="Month close"
          id="pol-c"
          hint="The window for everyone to catch up. After it, meals and leave freeze; payments carry on."
        >
          <select
            id="pol-c"
            value={close.mode}
            onChange={(e) =>
              setP({
                ...p,
                monthClose:
                  e.target.value === "off"
                    ? { mode: "off" }
                    : e.target.value === "manual"
                      ? { mode: "manual", afterClose: "flag" }
                      : { mode: "auto", afterDays: 5, afterClose: "flag" },
              })
            }
          >
            <option value="off">Never closed</option>
            <option value="manual">Closed by the admin</option>
            <option value="auto">Closes by itself</option>
          </select>
        </Field>
        {close.mode === "auto" ? (
          <Field label="Days after month end" id="pol-cd">
            <input
              id="pol-cd"
              type="number"
              min={0}
              max={60}
              value={close.afterDays}
              onChange={(e) =>
                setP({ ...p, monthClose: { ...close, afterDays: Number(e.target.value) } })
              }
            />
          </Field>
        ) : null}
        {close.mode !== "off" ? (
          <Field label="Entries after close" id="pol-ca">
            <select
              id="pol-ca"
              value={close.afterClose}
              onChange={(e) =>
                setP({
                  ...p,
                  monthClose: { ...close, afterClose: e.target.value as "flag" | "block" },
                })
              }
            >
              <option value="flag">Allowed, and flagged</option>
              <option value="block">Not allowed</option>
            </select>
          </Field>
        ) : null}
        {full ? (
          <Field label="Rate cards may start" id="pol-b">
            <select
              id="pol-b"
              value={full.rateCards.backdating}
              onChange={(e) =>
                setP({
                  ...full,
                  rateCards: { backdating: e.target.value as Policy["rateCards"]["backdating"] },
                })
              }
            >
              <option value="none">Only from today</option>
              <option value="current_month">From the start of this month</option>
              <option value="unrestricted">Any date</option>
            </select>
          </Field>
        ) : null}
      </div>
      <div className="pair">
        <Field
          label="Exceptions due, days before"
          id="pol-x"
          hint="Empty means any time. Anything added after its day is always marked late."
        >
          <input
            id="pol-x"
            type="number"
            min={0}
            max={7}
            value={p.exceptionCutoff?.daysBefore ?? ""}
            onChange={(e) =>
              setP({
                ...p,
                exceptionCutoff:
                  e.target.value === ""
                    ? null
                    : {
                        daysBefore: Number(e.target.value),
                        time: p.exceptionCutoff?.time ?? "20:00",
                      },
              })
            }
          />
        </Field>
        {p.exceptionCutoff ? (
          <Field label="By this time" id="pol-xt">
            <input
              id="pol-xt"
              type="time"
              value={p.exceptionCutoff.time}
              onChange={(e) =>
                setP({
                  ...p,
                  exceptionCutoff: { ...must(p.exceptionCutoff), time: e.target.value },
                })
              }
            />
          </Field>
        ) : null}
      </div>
      <div>
        <button type="submit" className="btn" disabled={act.busy || p.workingDays.length === 0}>
          Save rules
        </button>
      </div>
    </Form>
  );
}

/** The rules each month follows. A kitchen that does not track money is not shown the money rules. */
export function Rates() {
  const ws = useWorkspace();
  const pols = useLoad(
    () => getJson<{ effectiveFrom: string; doc: PolicyView }[]>(`${ws.api}/policies`),
    [ws.api],
  );
  const [open, setOpen] = useState(false);
  const current = pols.data?.length
    ? must(pols.data[pols.data.length - 1]).doc
    : (ws.boot.policy ?? DEFAULT_POLICY);
  const full = ws.money ? (current as Policy) : null;
  return (
    <div className="stack" style={{ ["--gap" as string]: "24px" }}>
      <PageHead
        title={ws.money ? "Rates and rules" : "Rules"}
        lead={
          ws.money
            ? "The rules each bill follows. What things cost is under Prices."
            : "The rules each month follows."
        }
      />
      <Problem error={pols.error} />
      <section className="stack" aria-label="Rules">
        <SectionHead
          title="Rules for this kitchen"
          actions={
            <button
              type="button"
              className="btn small"
              disabled={!ws.writable}
              onClick={() => setOpen(true)}
            >
              Change rules
            </button>
          }
        />
        <div className="card">
          <ul className="stack plain-list" style={{ ["--gap" as string]: "var(--space-2)" }}>
            <li>Meals on {current.workingDays.map((d) => dayName(d as Weekday)).join(", ")}.</li>
            <li>
              {current.holidays.count === "confirmed"
                ? "Only confirmed holidays cancel a meal."
                : "Every listed holiday cancels a meal."}
            </li>
            {full ? (
              <li>A leave day is charged {full.leave.chargeBps / 100}% of the meal.</li>
            ) : null}
            {full ? (
              <li>
                {full.monthlyFee
                  ? `The monthly fee applies from ${full.monthlyFee.minDays} day${full.monthlyFee.minDays === 1 ? "" : "s"} with a meal.`
                  : "No monthly fee."}
              </li>
            ) : null}
            <li>
              {current.monthClose.mode === "off"
                ? "Months are never closed."
                : current.monthClose.mode === "manual"
                  ? "The admin closes each month."
                  : `Months close by themselves ${current.monthClose.afterDays} days after they end.`}
              {current.monthClose.mode !== "off"
                ? current.monthClose.afterClose === "flag"
                  ? " Later changes are flagged."
                  : " Later changes are not allowed."
                : ""}
            </li>
            {full ? (
              <li>
                {full.payments === "claim_confirm"
                  ? "Members claim a payment and the supplier confirms it."
                  : "Payments are recorded directly."}
              </li>
            ) : null}
            <li>
              {current.exceptionCutoff
                ? `Exceptions are due ${current.exceptionCutoff.daysBefore} day(s) before, by ${current.exceptionCutoff.time}. After that, the admin can still add one for you, marked late.`
                : "Exceptions can be added at any time. One added after its day is marked late, so everyone can see."}
            </li>
          </ul>
        </div>
      </section>
      <Dialog open={open} onClose={() => setOpen(false)} title="Change the rules">
        {open ? (
          <PolicyForm
            current={current}
            onDone={() => {
              setOpen(false);
              pols.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
