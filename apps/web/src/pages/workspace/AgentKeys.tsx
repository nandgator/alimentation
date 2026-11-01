import { useState } from 'react';
import { api, getJson, postJson } from '../../api.ts';
import {
  Chip,
  CopyButton,
  Field,
  Form,
  Problem,
  toast,
  useAction,
  useLoad,
} from '../../components/ui.tsx';
import { date } from '../../format.ts';
import { useWorkspace } from './context.tsx';

interface Key {
  id: string;
  name: string;
  role: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  mine: boolean;
  ownerEmail?: string;
}

const SCOPES = [
  ['log', 'May add and withdraw entries (leaves, extras, days off).'],
  ['claims', 'May say that a payment was made.'],
] as const;

/**
 * Keys for AI agents: what they are, who has them, and a way to make one and to end one. Closed unless opened, because
 * most kitchens never have one. A key's token is shown once, when it is made, and is not kept here.
 */
export function AgentKeys() {
  const ws = useWorkspace();
  const list = useLoad(() => getJson<{ keys: Key[] }>(`${ws.api}/agents`), [ws.api]);
  const act = useAction();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const keys = list.data?.keys ?? [];

  return (
    <details className="card">
      <summary>AI agents</summary>
      <div className="stack">
        <p className="muted">
          A key lets software act for a person here: as them, in the role you are using, and no
          further. It can read; if you allow it, it can add entries or say a payment was made.
          Confirming payments, closing months and everything about people, prices and the kitchen
          itself stay with a person. What it does is marked in the kitchen&apos;s history as an
          agent&apos;s, for everyone it affects to read. The key is shown once.
        </p>
        <Problem error={list.error} />
        {fresh ? (
          <div className="banner info" role="status">
            <div className="stack">
              <p>
                <strong>{fresh.name}</strong>: copy this key now. It will not be shown again.
              </p>
              <span className="row" style={{ ['--gap' as string]: 'var(--space-2)' }}>
                <input
                  aria-label="The key"
                  readOnly
                  value={fresh.token}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton text={fresh.token} label="Copy the key" />
              </span>
              <p className="small muted">
                Its address for software that speaks MCP is <code>{location.origin}/mcp</code>, with
                the key as a bearer token.
              </p>
              <button className="btn ghost small" onClick={() => setFresh(null)}>
                I have copied it
              </button>
            </div>
          </div>
        ) : null}
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const made = await postJson<{ name: string; token: string }>(`${ws.api}/agents`, {
                name,
                scopes,
                days,
              });
              setFresh({ name: made.name, token: made.token });
              setName('');
              setScopes([]);
              list.reload();
            })
          }
        >
          <Field
            label="Name for the key"
            id="agent-name"
            hint="What it is for, so you know which to end later."
          >
            <input
              id="agent-name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <fieldset className="stack" style={{ ['--gap' as string]: 'var(--space-2)' }}>
            <legend>What it may do besides reading</legend>
            {SCOPES.map(([key, label]) => (
              <label key={key} className="row" style={{ ['--gap' as string]: 'var(--space-3)' }}>
                <input
                  type="checkbox"
                  checked={scopes.includes(key)}
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, key] : scopes.filter((s) => s !== key))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Days it lasts" id="agent-days" hint="Up to 365.">
            <input
              id="agent-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
          <button className="btn" disabled={act.busy}>
            Make a key
          </button>
        </Form>
        {keys.length > 0 ? (
          <div
            className="tablewrap"
            tabIndex={0}
            role="region"
            aria-label="Keys; scrolls sideways when it is wider than the screen"
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>For</th>
                  <th>May</th>
                  <th>Last used</th>
                  <th>Ends</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const ended = k.revokedAt !== null || new Date(k.expiresAt) < new Date();
                  return (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>
                        {k.mine ? 'You' : (k.ownerEmail ?? 'Someone')}, as {k.role}
                      </td>
                      <td>{k.scopes.join(', ')}</td>
                      <td>{k.lastUsedAt ? date(k.lastUsedAt.slice(0, 10)) : 'Never'}</td>
                      <td>
                        {ended ? (
                          <Chip tone="warn">{k.revokedAt ? 'Ended' : 'Expired'}</Chip>
                        ) : (
                          date(k.expiresAt.slice(0, 10))
                        )}
                      </td>
                      <td className="r">
                        {ended ? null : (
                          <button
                            className="btn ghost small"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run(async () => {
                                await api.del(`${ws.api}/agents/${k.id}`);
                                toast(`${k.name} no longer works.`);
                                list.reload();
                              })
                            }
                          >
                            End it
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}
