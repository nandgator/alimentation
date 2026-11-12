import { type PersonDto, peopleToCsv, type Role } from "@alimentation/core";
import { useState } from "react";
import { api, postJson } from "../../api.ts";
import { inOrder, liveOn, serviceName } from "../../catalogue.ts";
import { Chip, Dialog, Field, Form, PageHead, toast, useAction } from "../../components/ui.tsx";
import { rowsAfter, type Slot, sameRows, slotOf, takenOn } from "../../enrolment.ts";
import { date } from "../../format.ts";
import { useWorkspace } from "./context.tsx";
import { downloadCsv, ImportPeopleDialog } from "./PeopleImport.tsx";

const ROLES: Role[] = ["consumer", "supplier", "admin"];
const LABEL: Record<Role, string> = { consumer: "Member", supplier: "Supplier", admin: "Admin" };

function PersonForm({ person, onDone }: { person: PersonDto | null; onDone: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState(person?.name ?? "");
  const [role, setRole] = useState<Role>(person?.role ?? "consumer");
  const [contact, setContact] = useState(person?.contact ?? "");
  const [from, setFrom] = useState(person?.activeFrom ?? "");
  const [to, setTo] = useState(person?.activeTo ?? "");
  const [key, setKey] = useState(person?.externalKey ?? "");
  // A key is set once, and then it never changes.
  const keyFixed = !!person?.externalKey;
  const act = useAction();
  // Which services a member takes, and from when. A kitchen with one service has nothing to choose.
  const mine = ws.boot.enrolments.filter((e) => e.personId === person?.id);
  const choosable = inOrder(liveOn(ws.boot.services, ws.boot.today));
  const askServices = !!person && person.role === "consumer" && choosable.length >= 2;
  const [slots, setSlots] = useState<Record<string, Slot>>(() =>
    Object.fromEntries(
      choosable.map((sv) => [sv.id, slotOf(mine, sv.id, person?.activeFrom ?? ws.boot.today)]),
    ),
  );
  const setSlot = (id: string, patch: Partial<Slot>) =>
    setSlots((all) => ({ ...all, [id]: { ...(all[id] as Slot), ...patch } }));
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          const body = {
            name,
            contact: contact || null,
            activeFrom: from || null,
            activeTo: to || null,
          };
          if (person)
            await api.patch(
              `${ws.api}/people/${person.id}`,
              key && !keyFixed ? { ...body, externalKey: key } : body,
            );
          else await postJson(`${ws.api}/people`, { ...body, role, externalKey: key || null });
          if (person && askServices) {
            const next = rowsAfter(mine, slots);
            if (!sameRows(next, mine))
              await api.put(`${ws.api}/people/${person.id}/services`, { services: next });
          }
          toast("Saved.");
          onDone();
          ws.reload();
        })
      }
    >
      <Field label="Name" id="pname">
        <input
          id="pname"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {!person ? (
        <Field label="Role" id="prole">
          <select id="prole" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field
        label="Contact (optional)"
        id="pcontact"
        hint="Only you can see this. It is stored encrypted."
      >
        <input
          id="pcontact"
          maxLength={200}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </Field>
      <Field
        label="Key (optional)"
        id="pkey"
        hint={
          keyFixed
            ? "Your own code for this person. It is fixed once set."
            : "Your own code for this person, such as a room or staff number. A file you import later finds them by it. Once set it cannot be changed. Letters, digits and . _ : / # - only; not a name, email or phone number."
        }
      >
        <input
          id="pkey"
          maxLength={64}
          pattern="[A-Za-z0-9][A-Za-z0-9._:\/#\-]*"
          readOnly={keyFixed}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      {role === "consumer" ? (
        <div className="pair">
          <Field label="Eating from" id="pfrom">
            <input id="pfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until (optional)" id="pto">
            <input id="pto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      ) : null}
      {askServices ? (
        <fieldset className="choices stack">
          <legend>Services</legend>
          <p className="muted small">
            What {person?.name} eats, and from when. A day in a service they do not take is not
            theirs to log, and is not billed.
          </p>
          {choosable.map((sv) => {
            const slot = slots[sv.id] as Slot;
            return (
              <div key={sv.id} className="pair">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={slot.on}
                    onChange={(e) => setSlot(sv.id, { on: e.target.checked })}
                  />
                  {sv.name}
                </label>
                {slot.on ? (
                  <>
                    <Field label={`${sv.name} from`} id={`sv-from-${sv.id}`}>
                      <input
                        id={`sv-from-${sv.id}`}
                        type="date"
                        required
                        value={slot.from}
                        onChange={(e) => setSlot(sv.id, { from: e.target.value })}
                      />
                    </Field>
                    <Field label={`${sv.name} until (optional)`} id={`sv-to-${sv.id}`}>
                      <input
                        id={`sv-to-${sv.id}`}
                        type="date"
                        value={slot.to}
                        onChange={(e) => setSlot(sv.id, { to: e.target.value })}
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}
      {!person && role === "consumer" && choosable.length >= 2 ? (
        <p className="muted small">
          A new member takes every service. You can change that after adding them.
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn" disabled={act.busy}>
          Save
        </button>
      </div>
      {person ? (
        <div className="dlg-foot">
          <p className="muted small">
            {person.status === "ACTIVE"
              ? "Disabling keeps their history and stops new entries."
              : "Disabled: their history is kept and no new entries can be made."}
          </p>
          <button
            type="button"
            className="btn ghost small"
            disabled={act.busy}
            onClick={() =>
              void act.run(async () => {
                await api.patch(`${ws.api}/people/${person.id}`, {
                  status: person.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                });
                toast(person.status === "ACTIVE" ? "Disabled." : "Enabled.");
                onDone();
                ws.reload();
              })
            }
          >
            {person.status === "ACTIVE" ? "Disable" : "Enable"} {person.name}
          </button>
        </div>
      ) : null}
    </Form>
  );
}

function Invite({ person }: { person: PersonDto }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const act = useAction();
  return link ? (
    <div className="stack">
      <p>
        Send this link to {person.name}. It works once, for 7 days, and only with the email you
        typed.
      </p>
      <input
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Invitation link"
      />
      <button
        type="button"
        className="btn ghost"
        onClick={() => void navigator.clipboard?.writeText(link).then(() => toast("Copied."))}
      >
        Copy
      </button>
    </div>
  ) : (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          const r = await postJson<{ link: string }>(`${ws.api}/people/${person.id}/invite`, {
            email,
          });
          setLink(r.link);
        })
      }
    >
      <Field label={`${person.name}’s email`} id="iemail" hint="They sign in with this address.">
        <input
          id="iemail"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <div>
        <button type="submit" className="btn" disabled={act.busy}>
          Make a link
        </button>
      </div>
    </Form>
  );
}

export function People() {
  const ws = useWorkspace();
  const [edit, setEdit] = useState<PersonDto | "new" | null>(null);
  const [invite, setInvite] = useState<PersonDto | null>(null);
  const [importing, setImporting] = useState(false);
  const several = liveOn(ws.boot.services, ws.boot.today).length >= 2;
  return (
    <div className="stack">
      <PageHead
        title="People"
        lead="Everyone you feed, and the people who help run the kitchen."
        actions={
          <>
            <button
              type="button"
              className="btn ghost"
              onClick={() => downloadCsv("people.csv", peopleToCsv(ws.boot.people))}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!ws.writable}
              onClick={() => setImporting(true)}
            >
              Import
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ws.writable}
              onClick={() => setEdit("new")}
            >
              Add a person
            </button>
          </>
        }
      />
      <div
        className="tablewrap"
        tabIndex={0}
        role="region"
        aria-label="Table; scrolls sideways when it is wider than the screen"
      >
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Role</th>
              {several ? <th>Services</th> : null}
              <th>Signed in</th>
              <th>Contact</th>
              <th>From</th>
              <th>Until</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ws.boot.people.map((p) => (
              <tr key={p.id} className={p.status === "DISABLED" ? "projected" : ""}>
                <td className="linked">
                  <button
                    type="button"
                    disabled={!ws.writable}
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setEdit(p)}
                  >
                    <span className="nm">{p.name}</span>
                    {p.status === "DISABLED" ? <Chip>Disabled</Chip> : null}
                  </button>
                </td>
                <td>{p.externalKey ?? "-"}</td>
                <td>{LABEL[p.role]}</td>
                {several ? (
                  <td>
                    {p.role === "consumer"
                      ? takenOn(
                          ws.boot.enrolments.filter((e) => e.personId === p.id),
                          ws.boot.today,
                        )
                          .map((id) => serviceName(ws.boot, id))
                          .join(", ") || "-"
                      : "-"}
                  </td>
                ) : null}
                <td>{p.linked ? <Chip tone="good">Yes</Chip> : <Chip>Not yet</Chip>}</td>
                <td>{p.contact ?? "-"}</td>
                <td>{p.activeFrom ? date(p.activeFrom) : "-"}</td>
                <td>{p.activeTo ? date(p.activeTo) : "-"}</td>
                <td className="r">
                  {!p.linked && p.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className="quiet"
                      disabled={!ws.writable}
                      onClick={() => setInvite(p)}
                    >
                      Invite
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {ws.boot.meter
          ? `${ws.boot.meter.usage.people} of the free tier’s people allowance used. `
          : ""}
        Disabling someone keeps their history and stops new entries.
      </p>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit === "new" ? "Add a person" : "Edit person"}
      >
        {edit ? (
          <PersonForm person={edit === "new" ? null : edit} onDone={() => setEdit(null)} />
        ) : null}
      </Dialog>
      <ImportPeopleDialog open={importing} onClose={() => setImporting(false)} />
      <Dialog open={!!invite} onClose={() => setInvite(null)} title="Invite">
        {invite ? <Invite person={invite} /> : null}
      </Dialog>
    </div>
  );
}
