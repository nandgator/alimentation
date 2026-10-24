import { useState } from 'react';
import type { PersonDto, Role } from '@alimentation/core';
import { api, postJson } from '../../api.ts';
import { Chip, Dialog, Field, Form, toast, useAction } from '../../components/ui.tsx';
import { date } from '../../format.ts';
import { useWorkspace } from './context.tsx';

const ROLES: Role[] = ['consumer', 'supplier', 'admin'];
const LABEL: Record<Role, string> = { consumer: 'Member', supplier: 'Supplier', admin: 'Admin' };

function PersonForm({ person, onDone }: { person: PersonDto | null; onDone: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'consumer');
  const [contact, setContact] = useState(person?.contact ?? '');
  const [from, setFrom] = useState(person?.activeFrom ?? '');
  const [to, setTo] = useState(person?.activeTo ?? '');
  const act = useAction();
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
          if (person) await api.patch(`${ws.api}/people/${person.id}`, body);
          else await postJson(`${ws.api}/people`, { ...body, role });
          toast('Saved.');
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
      {role === 'consumer' ? (
        <div className="pair">
          <Field label="Eating from" id="pfrom">
            <input id="pfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until (optional)" id="pto">
            <input id="pto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      ) : null}
      <div>
        <button className="btn" disabled={act.busy}>
          Save
        </button>
      </div>
    </Form>
  );
}

function Invite({ person }: { person: PersonDto }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState('');
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
        className="btn ghost"
        onClick={() => void navigator.clipboard?.writeText(link).then(() => toast('Copied.'))}
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
        <button className="btn" disabled={act.busy}>
          Make a link
        </button>
      </div>
    </Form>
  );
}

export function People() {
  const ws = useWorkspace();
  const [edit, setEdit] = useState<PersonDto | 'new' | null>(null);
  const [invite, setInvite] = useState<PersonDto | null>(null);
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>People</h1>
        <button className="btn" disabled={!ws.writable} onClick={() => setEdit('new')}>
          Add a person
        </button>
      </div>
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
              <th>Role</th>
              <th>Signed in</th>
              <th>Contact</th>
              <th>From</th>
              <th>Until</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ws.boot.people.map((p) => (
              <tr key={p.id} className={p.status === 'DISABLED' ? 'projected' : ''}>
                <td>
                  {p.name} {p.status === 'DISABLED' ? <Chip>Disabled</Chip> : null}
                </td>
                <td>{LABEL[p.role]}</td>
                <td>{p.linked ? <Chip tone="good">Yes</Chip> : <Chip>Not yet</Chip>}</td>
                <td>{p.contact ?? '-'}</td>
                <td>{p.activeFrom ? date(p.activeFrom) : '-'}</td>
                <td>{p.activeTo ? date(p.activeTo) : '-'}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn ghost small"
                      disabled={!ws.writable}
                      onClick={() => setEdit(p)}
                    >
                      Edit
                    </button>
                    {!p.linked && p.status === 'ACTIVE' ? (
                      <button
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() => setInvite(p)}
                      >
                        Invite
                      </button>
                    ) : null}
                    {p.status === 'ACTIVE' ? (
                      <button
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .patch(`${ws.api}/people/${p.id}`, { status: 'DISABLED' })
                            .then(ws.reload, (e: Error) => toast(e.message))
                        }
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .patch(`${ws.api}/people/${p.id}`, { status: 'ACTIVE' })
                            .then(ws.reload, (e: Error) => toast(e.message))
                        }
                      >
                        Enable
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {ws.boot.meter
          ? `${ws.boot.meter.usage.people} of the free tier’s people allowance used. `
          : ''}
        Disabling someone keeps their history and stops new entries.
      </p>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'Add a person' : 'Edit person'}
      >
        {edit ? (
          <PersonForm person={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />
        ) : null}
      </Dialog>
      <Dialog open={!!invite} onClose={() => setInvite(null)} title="Invite">
        {invite ? <Invite person={invite} /> : null}
      </Dialog>
    </div>
  );
}
