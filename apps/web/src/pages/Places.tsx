import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { getJson, postJson, type Capacity } from '../api.ts';
import { AppBar, Page, RequireSignIn } from '../components/Chrome.tsx';
import { Chip, Field, Form, useAction } from '../components/ui.tsx';
import { useSession } from '../session.tsx';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function NewKitchen({ cap }: { cap: Capacity | null }) {
  const [, go] = useLocation();
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [supplier, setSupplier] = useState(true);
  const act = useAction();
  return (
    <section className="card stack" aria-labelledby="new-h">
      <h2 id="new-h">Start a kitchen</h2>
      {cap && !cap.dedicated && !cap.open ? (
        <div className="banner warn">
          The free places are full for now. You can try again later, or run your own instance and
          move in.
        </div>
      ) : null}
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            const made = await postJson<{ slug: string }>('/api/workspaces', {
              slug,
              name,
              alsoSupplier: supplier,
            });
            await refresh();
            go(`/w/${made.slug}`);
          })
        }
      >
        <Field label="Name" id="kname" hint="What your people call it.">
          <input
            id="kname"
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!touched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          label="Address"
          id="kslug"
          hint="Letters, numbers and dashes. This is what the link will say: /w/…"
        >
          <input
            id="kslug"
            required
            minLength={3}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
            value={slug}
            onChange={(e) => {
              setTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <label className="row" style={{ ['--gap' as string]: 'var(--space-3)' }}>
          <input
            type="checkbox"
            checked={supplier}
            onChange={(e) => setSupplier(e.target.checked)}
          />
          <span>I also cook for them (add me as the supplier too)</span>
        </label>
        <button className="btn" disabled={act.busy || (cap ? !cap.open && !cap.dedicated : false)}>
          Create
        </button>
      </Form>
    </section>
  );
}

export function Places() {
  const { me } = useSession();
  const [cap, setCap] = useState<Capacity | null>(null);
  useEffect(() => {
    getJson<Capacity>('/api/public/capacity').then(setCap, () => setCap(null));
  }, []);
  const list = me?.workspaces ?? [];
  return (
    <>
      <AppBar>
        {me?.operator ? (
          <Link href="/operator" className="btn ghost small">
            Operator
          </Link>
        ) : null}
      </AppBar>
      <RequireSignIn>
        <Page title="Your kitchens">
          {list.length === 0 ? (
            <p className="muted">
              You are not in any kitchen yet. Start one below, or open the invitation link someone
              sent you.
            </p>
          ) : (
            <ul className="stack" style={{ ['--gap' as string]: 'var(--space-3)' }}>
              {list.map((w) => (
                <li key={w.slug}>
                  <div className="card row between">
                    <div>
                      <h3>{w.name}</h3>
                      <p className="muted small">
                        /w/{w.slug} · {w.roles.join(', ')}
                      </p>
                    </div>
                    <div className="row">
                      {w.state === 'MOVED' ? <Chip tone="warn">Moved</Chip> : null}
                      {w.state === 'MIGRATING' ? <Chip tone="warn">Moving</Chip> : null}
                      {w.state === 'MOVED' && w.movedTo ? (
                        <a className="btn small" href={w.movedTo}>
                          Open at its new address
                        </a>
                      ) : (
                        <Link className="btn small" href={`/w/${w.slug}`}>
                          Open
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {cap?.dedicated && !me?.operator ? (
            <div className="banner info">
              This is a private instance. Ask whoever runs it to add a kitchen for you.
            </div>
          ) : (
            <NewKitchen cap={cap} />
          )}
        </Page>
      </RequireSignIn>
    </>
  );
}
