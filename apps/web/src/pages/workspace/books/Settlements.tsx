import { SETTLEMENT_TYPES, type SettlementDto, type SettlementType } from "@alimentation/core";
import { useState } from "react";
import { getJson, postJson } from "../../../api.ts";
import { Button } from "../../../components/legacy/button.tsx";
import { Card } from "../../../components/legacy/card.tsx";
import { Input } from "../../../components/legacy/input.tsx";
import { Select } from "../../../components/legacy/select.tsx";
import {
  Field,
  Form,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from "../../../components/ui.tsx";
import { date, money, month as monthLabel, toPaise } from "../../../format.ts";
import { useWorkspace } from "../context.tsx";

export function Settlements() {
  const ws = useWorkspace();
  const consumers = ws.boot.people.filter((p) => p.role === "consumer");
  const list = useLoad(() => getJson<SettlementDto[]>(`${ws.api}/settlements`), [ws.api]);
  const [who, setWho] = useState(consumers[0]?.id ?? "");
  const [forMonth, setForMonth] = useState(ws.boot.currentMonth);
  const [type, setType] = useState<SettlementType>("Payment");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const act = useAction();
  const needsAmount = type !== "Query";
  return (
    <div className="stack" style={{ ["--gap" as string]: "20px" }}>
      <PageHead
        title="Settlements"
        lead="An admin’s own entries: payments taken outside the app, queries raised, queries resolved. They are added, never changed."
      />
      <Card className="stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const paise = needsAmount ? toPaise(amount) : null;
              if (needsAmount && paise === null) throw new Error("Enter the amount in rupees.");
              await postJson(`${ws.api}/settlements`, {
                consumerId: who,
                forMonth,
                type,
                amount: paise,
                note: note.trim() || null,
              });
              setAmount("");
              setNote("");
              toast("Recorded.");
              list.reload();
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Who" id="swho">
              <Select id="swho" value={who} onChange={(e) => setWho(e.target.value)}>
                {consumers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Month" id="smonth">
              <Select
                id="smonth"
                value={forMonth}
                onChange={(e) => setForMonth(e.target.value as typeof forMonth)}
              >
                {[...ws.boot.months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type" id="stype">
              <Select
                id="stype"
                value={type}
                onChange={(e) => setType(e.target.value as SettlementType)}
              >
                {SETTLEMENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            {needsAmount ? (
              <Field label="Amount (₹)" id="samount">
                <Input
                  id="samount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <Field label="Note" id="snote">
            <Input
              id="snote"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" disabled={act.busy || !ws.writable}>
              Record
            </Button>
          </div>
        </Form>
      </Card>
      <Problem error={list.error} />
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data && list.data.length > 0 ? (
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
                <th>Who</th>
                <th>Month</th>
                <th>Type</th>
                <th className="r">Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>{date(s.date)}</td>
                  <td>{ws.nameOf(s.consumerId)}</td>
                  <td>{monthLabel(s.forMonth)}</td>
                  <td>{s.type}</td>
                  <td className="r">{s.amount === null ? "-" : money(s.amount)}</td>
                  <td className="cell-text">{s.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
