import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { FREE_LIMITS, GRACE_DAYS, THRESHOLDS } from '@alimentation/core';
import { getJson, type Capacity } from '../api.ts';
import { Mark } from '../components/Mark.tsx';
import { useSession } from '../session.tsx';

const PROMISES: { n: string; title: string; how: string; limit: string }[] = [
  {
    n: 'I',
    title: 'Nobody can crowd you out.',
    how: 'Every kitchen has a database of its own and a daily allowance of its own. A noisy neighbour meets its own ceiling, not yours.',
    limit:
      'The web layer is shared, so fairness comes from budgets we enforce, not from a guarantee by the host.',
  },
  {
    n: 'II',
    title: 'Free until you outgrow it, and we say so early.',
    how: `A meter speaks up at ${THRESHOLDS.watch * 100}, ${THRESHOLDS.ask * 100} and 100 percent, then allows ${GRACE_DAYS} days of grace. Reading and exporting are never blocked.`,
    limit: 'Our hosts can change their free limits. If they do, you will hear from us first.',
  },
  {
    n: 'III',
    title: 'Outgrow it, move in one click, lose nothing.',
    how: 'We rehearse the move, copy everything, recompute every statement from the raw entries and compare to the paisa, then switch. The old copy stays read-only for seven days.',
    limit: 'It needs somewhere to go: an empty Postgres, or the address of your own instance.',
  },
  {
    n: 'IV',
    title: 'Leave, and everything goes.',
    how: 'The keys are destroyed first, so nothing is readable from that moment. Then the database is removed, and you are given a receipt that names no one.',
    limit:
      'Our database host keeps a deleted project for up to seven days, unreadable without the destroyed key. Copies you exported are yours. Some logs the law requires may remain.',
  },
  {
    n: 'V',
    title: 'Your people’s details never appear in a log.',
    how: 'Names, contacts and notes are encrypted before they reach the database. What the logs carry is a pseudonym.',
    limit:
      'Amounts, dates and ids are not encrypted; without the key they cannot be tied to a person.',
  },
  {
    n: 'VI',
    title: 'Your data is yours to take, at any time.',
    how: 'A complete export in an open, versioned format, even when you are over the limit, even after you cancel.',
    limit: 'It is plain JSON. Keep it as carefully as you would a ledger.',
  },
  {
    n: 'VII',
    title: 'One person’s rows are invisible to everyone else.',
    how: 'Enforced inside the database, not just on the screen. A member sees their own bill and nobody else’s.',
    limit: 'The server is trusted to say who is asking; its credentials never leave it.',
  },
];

const fmt = new Intl.NumberFormat('en-IN');

function Station({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="station">
      <span className="glyph" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function Home() {
  const { me } = useSession();
  const [cap, setCap] = useState<Capacity | null>(null);
  useEffect(() => {
    getJson<Capacity>('/api/public/capacity').then(setCap, () => setCap(null));
  }, []);
  const signedIn = !!me?.account;
  const start = signedIn ? '/app' : '/signin';

  return (
    <div className="home">
      <header className="hnav">
        <div className="wrap">
          <Link href="/" className="brand">
            <Mark /> <span className="brand-text">Alimentation</span>
          </Link>
          <nav aria-label="Sections">
            <a href="#promises">Promises</a>
            <a href="#leaving">Leaving</a>
            <a href="#free">Free tier</a>
            <a href="#runs">Where it runs</a>
          </nav>
          <Link href={start} className="btn ghost small">
            {signedIn ? 'Open your kitchens' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <svg className="rings" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
            <circle cx="300" cy="300" r="290" />
            <circle cx="300" cy="300" r="214" />
            <circle cx="300" cy="300" r="138" />
            <circle className="bowl" cx="448" cy="152" r="26" />
          </svg>
          <div className="wrap">
            <p className="eyebrow rise" style={{ ['--d' as string]: '0ms' }}>
              Mess and tiffin accounts
            </p>
            <h1 className="rise" style={{ ['--d' as string]: '60ms' }}>
              A kitchen’s accounts, kept <em>honestly</em>, and returned to you whole.
            </h1>
            <p className="lede rise" style={{ ['--d' as string]: '140ms' }}>
              Every small kitchen gets a private workspace. It is free while you are small. When you
              grow, it moves to a place of your own in one click. And on the day you leave, it is
              deleted completely, down to the keys.
            </p>
            <div
              className="row rise"
              style={{ ['--d' as string]: '220ms', ['--gap' as string]: '14px' }}
            >
              <Link href={start} className="btn copper">
                {signedIn ? 'Open your kitchens' : 'Start a kitchen'}
              </Link>
              <a href="#leaving" className="btn ghost">
                See how leaving works
              </a>
            </div>
            <p className="cap rise" style={{ ['--d' as string]: '300ms' }} aria-live="polite">
              {cap ? (
                cap.dedicated ? (
                  <>
                    <i className="dot" /> A private instance, with no free-tier limits.
                  </>
                ) : cap.open ? (
                  <>
                    <i className="dot" /> {fmt.format(cap.used)} of {fmt.format(cap.capacity)} free
                    places taken
                  </>
                ) : (
                  <>
                    <i className="dot full" /> The free places are full for now. Bring your own
                    database to start today.
                  </>
                )
              ) : (
                <>&nbsp;</>
              )}
            </p>

            <ol
              className="journey rise"
              style={{ ['--d' as string]: '380ms' }}
              aria-label="Where a kitchen can live"
            >
              <Station
                title="Shared"
                icon={
                  <svg viewBox="0 0 32 32" width="30" height="30" {...stroke}>
                    <path d="M4 15 16 5l12 10M7 13v13h18V13M13 26v-7h6v7" />
                  </svg>
                }
              >
                Free. Your own database inside our shared service.
              </Station>
              <li className="link" aria-hidden="true">
                <span>one click</span>
              </li>
              <Station
                title="Your database"
                icon={
                  <svg viewBox="0 0 32 32" width="30" height="30" {...stroke}>
                    <ellipse cx="16" cy="8" rx="10" ry="4" />
                    <path d="M6 8v8c0 2.2 4.5 4 10 4s10-1.8 10-4V8M6 16v8c0 2.2 4.5 4 10 4s10-1.8 10-4v-8" />
                  </svg>
                }
              >
                Any Postgres you hold. We keep serving it, with nothing of ours left behind when you
                go.
              </Station>
              <li className="link" aria-hidden="true">
                <span>one click</span>
              </li>
              <Station
                title="Your own instance"
                icon={
                  <svg viewBox="0 0 32 32" width="30" height="30" {...stroke}>
                    <rect x="4" y="5" width="24" height="9" rx="2" />
                    <rect x="4" y="18" width="24" height="9" rx="2" />
                    <path d="M9 9.5h.01M9 22.5h.01M14 9.5h9M14 22.5h9" />
                  </svg>
                }
              >
                Everything on a server you run. One command to start.
              </Station>
              <li className="link gone" aria-hidden="true">
                <span>or leave, from anywhere</span>
              </li>
              <Station
                title="Gone"
                icon={
                  <svg viewBox="0 0 32 32" width="30" height="30" {...stroke}>
                    <circle cx="16" cy="16" r="11" strokeDasharray="2.5 3.2" />
                    <path d="m11 16.5 3.5 3.5 7-8" />
                  </svg>
                }
              >
                Keys destroyed, database removed, and a receipt that names no one.
              </Station>
            </ol>
          </div>
        </section>

        <section id="promises" className="section">
          <div className="wrap">
            <p className="eyebrow">What we promise</p>
            <h2>Seven promises, each with its limit stated beside it.</h2>
            <p className="lede2">
              Every promise below is the name of automated tests that run on each change. If a
              promise has no test, the build fails. The honest limit of each is part of the promise.
            </p>
            <ol className="promises">
              {PROMISES.map((p) => (
                <li key={p.n}>
                  <span className="numeral" aria-hidden="true">
                    {p.n}
                  </span>
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.how}</p>
                    <p className="limit">
                      <span>The limit.</span> {p.limit}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="leaving" className="section band">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Leaving is a feature</p>
              <h2>Not an exit interview. A procedure, in a fixed order.</h2>
              <ol className="steps">
                <li>
                  <b>Rehearse.</b> The move is tried on the destination first, with writing still
                  open. If anything fails, we remove what we added there and nothing has changed
                  here.
                </li>
                <li>
                  <b>Freeze and copy.</b> Writing pauses for the moment it takes. Every entry is
                  copied, every statement is recomputed from the raw entries, and each is compared
                  to the paisa.
                </li>
                <li>
                  <b>Switch.</b> Everyone signs in as before, with the same email. The old copy
                  stays read-only for seven days in case you change your mind.
                </li>
                <li>
                  <b>Wipe.</b> The keys are destroyed first. Then the database goes, then every
                  record of who was in it. Then a receipt.
                </li>
              </ol>
            </div>
            <figure className="receipt" aria-label="An example wipe receipt">
              <figcaption>Example receipt · yours will carry real figures</figcaption>
              <dl>
                <div>
                  <dt>Workspace</dt>
                  <dd className="mono">3f9c2e1a-7b64-4d08-9a15-c0de51ab07e2</dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>14-Mar-2027 09:12 · completed 09:12</dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>
                    <span className="tick">✓</span> Keys destroyed
                    <br />
                    <span className="tick">✓</span> Database removed
                    <br />
                    <span className="tick">✓</span> Directory entry gone
                    <br />
                    <span className="tick">✓</span> Memberships, invitations, usage gone
                  </dd>
                </div>
                <div>
                  <dt>Counted, never read</dt>
                  <dd>people 14 · log entries 2,311 · claims 96 · settlements 11</dd>
                </div>
                <div>
                  <dt>What remains</dt>
                  <dd>
                    This receipt. A count-only event. Our database host’s recovery copy, up to seven
                    days, unreadable without the destroyed key.
                  </dd>
                </div>
              </dl>
              <p className="seal">
                Names no one. Written once: the application and the database’s owner role are both
                blocked from changing it.
              </p>
            </figure>
          </div>
        </section>

        <section id="free" className="section">
          <div className="wrap">
            <p className="eyebrow">The free tier</p>
            <h2>Free, with the limits in plain sight.</h2>
            <div className="limits">
              <div>
                <b>{fmt.format(FREE_LIMITS.people)}</b>
                <span>people</span>
              </div>
              <div>
                <b>{fmt.format(FREE_LIMITS.rows)}</b>
                <span>entries</span>
              </div>
              <div>
                <b>{Math.round(FREE_LIMITS.bytes / 1048576)} MB</b>
                <span>of data</span>
              </div>
              <div>
                <b>{fmt.format(FREE_LIMITS.requestsPerDay)}</b>
                <span>requests a day</span>
              </div>
            </div>
            <p className="lede2">
              Plenty for a kitchen feeding a few dozen people. Past {THRESHOLDS.watch * 100} percent
              we tell you; at 100 percent you have {GRACE_DAYS} days before new entries pause.
              Reading and exporting never do. These are the defaults. The service can change them,
              and tells you if it does.
            </p>
          </div>
        </section>

        <section id="runs" className="section alt">
          <div className="wrap">
            <p className="eyebrow">Where it runs</p>
            <h2>On free platforms, or on your own.</h2>
            <div className="three">
              <article>
                <h3>The shared service</h3>
                <p>
                  Cloudflare serves the app and the interface. Each kitchen gets its own Neon
                  Postgres project, so one kitchen’s heavy month is never another’s slow one.
                </p>
              </article>
              <article>
                <h3>Your database</h3>
                <p>
                  Give us a connection string to an empty Postgres, from any provider. We install
                  our tables, and remove only our tables if you ever go.
                </p>
              </article>
              <article>
                <h3>Your instance</h3>
                <p>
                  One Docker command starts the whole thing with its own Postgres. Moving there is
                  the same one click, and the same checks.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="hfoot">
        <div className="wrap">
          <Link href="/" className="brand">
            <Mark /> <span className="brand-text">Alimentation</span>
          </Link>
          <p className="muted small">
            Made for small kitchens that feed people they know, with nothing to hide in the way out.
          </p>
          <nav aria-label="Footer">
            <Link href={start}>{signedIn ? 'Your kitchens' : 'Sign in'}</Link>
            <a href="#promises">Promises</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
