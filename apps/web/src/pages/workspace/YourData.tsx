import { useState } from 'react';
import { useLocation } from 'wouter';
import { GRACE_DAYS } from '@alimentation/core';
import { postJson } from '../../api.ts';
import { Field, Form, PageHead, Problem, toast, useAction } from '../../components/ui.tsx';
import { date } from '../../format.ts';
import { useWorkspace } from './context.tsx';

interface Preview {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
  digest: string | null;
  steps: string[];
}
interface Moved {
  target: 'database' | 'instance';
  digest: string;
  counts: Record<string, number>;
  movedTo: string | null;
  oldCopyRemovedBy: string;
}

const nf = new Intl.NumberFormat('en-IN');
const NAMES: Record<string, string> = {
  requestsLast24h: 'Requests, last 24 hours',
  people: 'People',
  rows: 'Entries',
  bytes: 'Data',
};
const size = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

function Usage() {
  const { boot } = useWorkspace();
  const m = boot.meter;
  if (!m) return null;
  const tone =
    m.state === 'OVER' ? 'bad' : m.state === 'ASK' ? 'warn' : m.state === 'WATCH' ? 'warn' : '';
  return (
    <section className="card stack" aria-label="Usage">
      <h2>Free tier</h2>
      {m.state === 'OK' ? <p className="muted">Well within the free tier.</p> : null}
      {m.state === 'WATCH' ? (
        <div className="banner warn">
          You have used more than 70 percent of the free allowance in one measure.
        </div>
      ) : null}
      {m.state === 'ASK' ? (
        <div className="banner warn">
          You are close to a free limit. Moving to a database of your own takes one click, and you
          can do it whenever you like below.
        </div>
      ) : null}
      {m.state === 'OVER' ? (
        <div className="banner bad">
          You have reached a free limit
          {m.graceEndsOn
            ? `. New entries pause after ${date(m.graceEndsOn)} (${GRACE_DAYS} days of grace)`
            : ''}
          . Reading and exporting always work.
        </div>
      ) : null}
      {(Object.keys(m.usage) as (keyof typeof m.usage)[]).map((k) => {
        const pct = Math.min(100, Math.round((m.ratios[k] ?? 0) * 100));
        return (
          <div key={k}>
            <div className="row between">
              <span>{NAMES[k]}</span>
              <span className="muted small num">
                {k === 'bytes' ? size(m.usage[k]) : nf.format(m.usage[k])} · {pct}%
              </span>
            </div>
            <div
              className={`meter ${pct >= 100 ? 'bad' : pct >= 70 ? 'warn' : ''}`}
              role="img"
              aria-label={`${NAMES[k]}: ${pct} percent of the free allowance`}
            >
              <i style={{ ['--pct' as string]: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <p className="muted small">{tone ? '' : 'The meter warns you well before anything stops.'}</p>
    </section>
  );
}

function Move() {
  const ws = useWorkspace();
  const [kind, setKind] = useState<'database' | 'instance'>('database');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [confirm, setConfirm] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Moved | null>(null);
  const check = useAction();
  const go = useAction();
  const target =
    kind === 'database'
      ? { kind, url: url.trim() }
      : { kind, url: url.trim(), token: token.trim() };
  const reset = () => setPreview(null);

  if (done)
    return (
      <section className="card stack" aria-label="Moved">
        <h2>Moved</h2>
        <div className="banner good">
          {done.target === 'database'
            ? 'Your kitchen now lives in your own database, and is served from there.'
            : 'Your kitchen now lives on your own instance.'}
        </div>
        <p>
          Everything was copied and every statement was recomputed from the raw entries and matched
          to the paisa. Checksum <code className="small">{done.digest.slice(0, 16)}…</code>
        </p>
        <p className="muted">
          The old copy stays read-only until {date(done.oldCopyRemovedBy.slice(0, 10))}, then it is
          removed.
        </p>
        {done.movedTo ? (
          <a className="btn" href={done.movedTo}>
            Open it at the new address
          </a>
        ) : null}
      </section>
    );

  return (
    <section className="card stack" aria-label="Move">
      <h2>Move to a place of your own</h2>
      <p className="muted">
        Nothing changes here until the copy has been checked. Everyone signs in as before, with the
        same email. This copy stays read-only for seven days, in case you change your mind.
      </p>
      <div className="row" role="tablist" aria-label="Where to">
        {(['database', 'instance'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={`btn small ${kind === k ? '' : 'ghost'}`}
            onClick={() => {
              setKind(k);
              reset();
            }}
          >
            {k === 'database' ? 'My own database' : 'My own instance'}
          </button>
        ))}
      </div>
      <Form
        error={check.error}
        onSubmit={() =>
          check.run(async () => {
            setPreview(await postJson<Preview>(`${ws.api}/move/preview`, target));
          })
        }
      >
        <Field
          label={
            kind === 'database'
              ? 'Connection string of an empty Postgres'
              : 'Address of your instance'
          }
          id="murl"
          hint={
            kind === 'database'
              ? 'postgres://user:password@host/database?sslmode=require'
              : 'https://kitchen.example.org'
          }
        >
          <input
            id="murl"
            required
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              reset();
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {kind === 'instance' ? (
          <Field label="Token" id="mtoken" hint="The migration token set on that instance.">
            <input
              id="mtoken"
              type="password"
              required
              minLength={24}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                reset();
              }}
              autoComplete="off"
            />
          </Field>
        ) : null}
        <div>
          <button className="btn ghost" disabled={check.busy || !ws.writable}>
            Check it first
          </button>
        </div>
      </Form>

      {preview ? (
        preview.ok ? (
          <div className="stack">
            <div className="banner good">It will work. Nothing has been changed.</div>
            <ol className="stack plain-list" style={{ ['--gap' as string]: 'var(--space-1)' }}>
              {preview.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="muted small">
              {Object.entries(preview.counts)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${k.replace(/_/g, ' ')} ${nf.format(n)}`)
                .join(' · ')}
            </p>
            <Form
              error={go.error}
              onSubmit={() =>
                go.run(async () => {
                  const r = await postJson<Moved>(`${ws.api}/move`, { target, confirm });
                  setDone(r);
                  toast('Moved.');
                  ws.reload();
                })
              }
            >
              <Field label={`Type ${ws.slug} to confirm`} id="mconfirm">
                <input
                  id="mconfirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <div>
                <button className="btn accent" disabled={go.busy || confirm !== ws.slug}>
                  Move now
                </button>
              </div>
            </Form>
          </div>
        ) : (
          <div className="banner bad" role="alert">
            <div>
              {preview.problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

function Export() {
  const ws = useWorkspace();
  const act = useAction();
  return (
    <section className="card stack" aria-label="Export">
      <h2>Take a copy</h2>
      <p className="muted">
        Everything in this kitchen, in an open format, with a checksum. It works at any time,
        including when you are over the limit.
      </p>
      <Problem error={act.error} />
      <div>
        <button
          className="btn ghost"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              const res = await fetch(`${ws.api}/export`, { credentials: 'same-origin' });
              if (!res.ok) throw new Error('The export could not be made. Try again.');
              const url = URL.createObjectURL(await res.blob());
              const a = document.createElement('a');
              a.href = url;
              a.download = `${ws.slug}.alimentation.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
            })
          }
        >
          Download everything
        </button>
      </div>
    </section>
  );
}

function Wipe() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const act = useAction();
  if (receipt)
    return (
      <section className="card stack" aria-label="Deleted">
        <h2>Deleted</h2>
        <div className="banner good">
          The keys are destroyed and the kitchen is gone. Nothing of it can be read.
        </div>
        <p>
          If this was your only kitchen, your sign-in record here was removed too. Keep this
          receipt: <a href={`/receipt/${receipt}`}>/receipt/{receipt.slice(0, 8)}…</a>. It names no
          one.
        </p>
        <button className="btn" onClick={() => navigate('/app')}>
          Back to your kitchens
        </button>
      </section>
    );
  return (
    <section className="card stack danger" aria-label="Delete">
      <h2>Delete everything</h2>
      <p>
        The keys are destroyed first, so from that moment nothing in this kitchen can be read by
        anyone, including us. Then the database is removed, then every record of who was in it. This
        cannot be undone.
      </p>
      <p className="muted small">
        Take a copy first if you may want it. Copies you have already downloaded are yours and are
        not touched.
      </p>
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            const r = await postJson<{
              done: boolean;
              receipt?: { workspaceId: string };
              retry?: string;
            }>(`${ws.api}/wipe`, { confirm });
            if (r.done && r.receipt) setReceipt(r.receipt.workspaceId);
            else throw new Error(r.retry ?? 'Started. The rest is removed shortly.');
          })
        }
      >
        <Field label={`Type ${ws.slug} to confirm`} id="wconfirm">
          <input
            id="wconfirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div>
          <button className="btn danger" disabled={act.busy || confirm !== ws.slug}>
            Delete this kitchen
          </button>
        </div>
      </Form>
    </section>
  );
}

export function YourData() {
  const ws = useWorkspace();
  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead
        title="Your data"
        lead={`${ws.boot.workspace.name} · /w/${ws.slug}. This is yours: take it, move it, or delete it.`}
      />
      <Usage />
      <Export />
      {ws.boot.workspace.state === 'ACTIVE' ? <Move /> : null}
      <Wipe />
    </div>
  );
}
