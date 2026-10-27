import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { FREE_LIMITS, GRACE_DAYS, THRESHOLDS } from '@alimentation/core';
import { getJson, type Capacity } from '../api.ts';
import { Mark } from '../components/Mark.tsx';
import { ThemeSwitch } from '../components/ThemeSwitch.tsx';
import { Defs, HeroScene } from '../home/art.tsx';
import { Month } from '../home/Month.tsx';
import { Figure, Lines, useLight, useLive, useReveal } from '../home/motion.tsx';
import { Stage } from '../home/Stage.tsx';
import { useSession } from '../session.tsx';

/** The seven promises. Each title is the ledger's wording (docs/PROMISES.md), kept equal by a check. */
const PROMISES: { title: string; how: string; limit: string }[] = [
  {
    title: 'Nobody can crowd you out.',
    how: 'Every kitchen has a book of its own and a daily allowance of its own. A noisy neighbour hits their own ceiling, never yours.',
    limit:
      'The part of the service that answers requests is shared, so fairness comes from limits we enforce, not from a guarantee by our host.',
  },
  {
    title: 'Free until you outgrow it, and we say so in advance.',
    how: `A meter speaks up at ${THRESHOLDS.watch * 100}, ${THRESHOLDS.ask * 100} and 100 percent, then gives you ${GRACE_DAYS} days of grace. Looking and exporting are never blocked.`,
    limit: 'Our hosts can change their free limits. If they do, you hear from us first.',
  },
  {
    title: 'Outgrow it, move in one click, lose nothing.',
    how: 'We practise the move, copy everything, work out every bill again from the raw entries and compare to the paisa, then switch. The old copy stays readable for seven days.',
    limit:
      'It needs somewhere to go: empty storage from any database provider, or your own copy of Alimentation.',
  },
  {
    title: 'Leave, and everything goes.',
    how: 'We destroy the keys first, so nothing can be read from that moment. Then we delete your book and hand you a receipt that names no one.',
    limit:
      'Our database host keeps a deleted project for up to seven days, unreadable without the destroyed keys. Copies you exported are yours. Some records the law requires may remain.',
  },
  {
    title: 'Your people’s details are never readable in logs.',
    how: 'Names, contacts and notes are scrambled before they reach the database. What a log carries is a made-up code.',
    limit:
      'Amounts, dates and ids are not scrambled. Without the key they cannot be tied to a person.',
  },
  {
    title: 'Your data is yours to take, at any time.',
    how: 'A full export in an open, documented format, even when you are over the limit, even after you cancel.',
    limit: 'It is plain text (JSON). Keep it as carefully as you would a ledger book.',
  },
  {
    title: 'One person’s records are invisible to everyone else.',
    how: 'The database itself enforces it, not only the screen. A member sees their own bill and nobody else’s.',
    limit: 'Our server tells the database who is asking, so its passwords never leave the server.',
  },
];

const fmt = new Intl.NumberFormat('en-IN');

export function Home() {
  const { me } = useSession();
  const [cap, setCap] = useState<Capacity | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  // What moves by itself: a slow light behind the first screen, and another that follows a pointer over the name.
  const hero = useRef<HTMLElement>(null);
  const close = useRef<HTMLElement>(null);
  const name = useRef<HTMLParagraphElement>(null);
  useLive(hero);
  useLight(close, name);
  useEffect(() => {
    getJson<Capacity>('/api/public/capacity').then(setCap, () => setCap(null));
  }, []);
  const signedIn = !!me?.account;
  const start = signedIn ? '/app' : '/signin';

  return (
    <div className="home" ref={root}>
      <Defs />
      <header className="hnav">
        <div className="hwrap">
          <Link href="/" className="brand">
            <Mark /> <span className="brand-text">Alimentation</span>
          </Link>
          <nav aria-label="Sections">
            <a href="#try">Try it</a>
            <a href="#free">Free</a>
            <a href="#moving">Moving</a>
            <a href="#leaving">Leaving</a>
            <a href="#promises">Promises</a>
            <a href="/guides/">Guides</a>
          </nav>
          <Link href={start} className="btn ghost small">
            {signedIn ? 'Open your kitchens' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main>
        <section className="hero" ref={hero}>
          <svg className="wall" aria-hidden="true" focusable="false">
            <rect width="100%" height="100%" fill="url(#tiles)" />
          </svg>
          <div className="hero-glow" aria-hidden="true">
            <i className="a" />
            <i className="b" />
          </div>
          <div className="hwrap hero-grid">
            <div className="hero-copy">
              <Lines as="h1" first lines={['Who ate, what it', 'cost, who paid']} />
              <p className="lead load" style={{ ['--d' as string]: '420ms' }}>
                Alimentation keeps the accounts for small mess and tiffin kitchens: every meal,
                every payment, and what each person still owes.
              </p>
              <div className="actions load" style={{ ['--d' as string]: '500ms' }}>
                <Link href={start} className="btn accent big">
                  {signedIn ? 'Open your kitchens' : 'Start your kitchen'}
                </Link>
                <a href="#try" className="textlink">
                  See how it works
                </a>
              </div>
              <p className="cap load" style={{ ['--d' as string]: '580ms' }} aria-live="polite">
                {cap ? (
                  cap.dedicated ? (
                    <>This is a private copy of Alimentation, with no free-tier limits.</>
                  ) : cap.open ? (
                    <>
                      {fmt.format(cap.used)} of {fmt.format(cap.capacity)} free kitchens taken
                    </>
                  ) : (
                    <>
                      The free kitchens are full for now. You can still start today with storage of
                      your own.
                    </>
                  )
                ) : (
                  <>&nbsp;</>
                )}
              </p>
            </div>
            <HeroScene />
          </div>
        </section>

        <section id="try" className="section" aria-labelledby="try-title">
          <Month />
        </section>

        <section id="free" className="section free" aria-labelledby="free-title">
          <div className="hwrap free-grid">
            <div>
              <Lines lines={['Free while', 'you’re small']} id="free-title" />
              <p className="statement" data-reveal>
                Enough for a kitchen that feeds up to {FREE_LIMITS.people} people every day. At{' '}
                {THRESHOLDS.watch * 100} percent full we tell you. At 100 percent you have{' '}
                {GRACE_DAYS} days before new entries pause. Looking at your book and taking a copy
                never pause.
              </p>
              <p className="statement-note" data-reveal>
                What counts as an entry? Each change someone logs (a leave, a switch, extra
                chapatis), each payment, and the cook’s answer to it. The meals nobody changes cost
                nothing. Everything is counted for the kitchen as a whole, not per person: 25 people
                who each log three changes a month and pay monthly use about 1,500 entries a year,
                so {fmt.format(FREE_LIMITS.rows)} lasts over three years.
              </p>
              <p className="catch" data-reveal>
                <b>The catch.</b> Our hosts can change their free limits. If they do, you hear from
                us first.
              </p>
            </div>
            <dl className="limits">
              <div>
                <dt>people</dt>
                <dd>
                  <Figure value={fmt.format(FREE_LIMITS.people)} />
                </dd>
              </div>
              <div>
                <dt>entries</dt>
                <dd>
                  <Figure value={fmt.format(FREE_LIMITS.rows)} />
                </dd>
              </div>
              <div>
                <dt>actions a day, all together</dt>
                <dd>
                  <Figure value={fmt.format(FREE_LIMITS.requestsPerDay)} />
                </dd>
              </div>
              <div>
                <dt>of records</dt>
                <dd>
                  <Figure value={String(Math.round(FREE_LIMITS.bytes / 1048576))} />
                  <span className="unit"> MB</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="moving" className="section steel" aria-labelledby="moving-title">
          <Stage />
        </section>

        <section id="leaving" className="section leaving" aria-labelledby="leaving-title">
          <div className="hwrap leaving-grid">
            <div>
              <Lines lines={['When you leave,', 'everything goes']} id="leaving-title" />
              <p className="statement" data-reveal>
                Stopping for good? There is no exit interview. Leaving is a fixed procedure, done in
                this order, and it ends with a receipt.
              </p>
              <ol className="wipe">
                <li data-reveal style={{ ['--d' as string]: '0ms' }}>
                  <b>We lock the keys away for good.</b> From that moment nothing in your book can
                  be read, by anyone.
                </li>
                <li data-reveal style={{ ['--d' as string]: '80ms' }}>
                  <b>We delete your book.</b> Every meal, payment and note.
                </li>
                <li data-reveal style={{ ['--d' as string]: '160ms' }}>
                  <b>We delete the list of who was in your kitchen.</b> Members, invitations and
                  usage.
                </li>
                <li data-reveal style={{ ['--d' as string]: '240ms' }}>
                  <b>We hand you a receipt.</b> It says what was removed and names no one.
                </li>
              </ol>
            </div>
            <div className="printer" data-reveal="print">
              <div className="paper">
                <figure className="receipt" aria-label="An example wipe receipt" data-ui>
                  <figcaption>Example receipt. Yours will carry real figures.</figcaption>
                  <dl>
                    <div>
                      <dt>Kitchen</dt>
                      <dd className="mono">3f9c2e1a-7b64-4d08-9a15-c0de51ab07e2</dd>
                    </div>
                    <div>
                      <dt>Asked for</dt>
                      <dd>14-Mar-2027 09:12 · done 09:12</dd>
                    </div>
                    <div>
                      <dt>Checked</dt>
                      <dd>
                        <span className="tick">✓</span> Keys destroyed
                        <br />
                        <span className="tick">✓</span> Book removed
                        <br />
                        <span className="tick">✓</span> Directory entry gone
                        <br />
                        <span className="tick">✓</span> Members, invitations and usage gone
                      </dd>
                    </div>
                    <div>
                      <dt>Counted, never read</dt>
                      <dd>people 14 · entries 2,311 · claims 96 · settlements 11</dd>
                    </div>
                    <div>
                      <dt>What remains</dt>
                      <dd>
                        This receipt. A count with no names. Our host’s recovery copy, for up to
                        seven days, unreadable without the destroyed keys.
                      </dd>
                    </div>
                  </dl>
                  <p className="seal">
                    Names no one. Written once: neither the app nor the database’s owner can change
                    it.
                  </p>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section id="promises" className="section" aria-labelledby="promises-title">
          <div className="hwrap">
            <Lines lines={['Seven promises,', 'and where each one stops']} id="promises-title" />
            <p className="statement" data-reveal>
              Each promise is backed by automated checks that run whenever we change anything. A
              promise with no check cannot ship.
            </p>
            <ol className="promises">
              {PROMISES.map((p, i) => (
                <li
                  key={p.title}
                  data-reveal="row"
                  style={{ ['--d' as string]: `${(i % 4) * 70}ms` }}
                >
                  <h3>{p.title}</h3>
                  <div>
                    <p>{p.how}</p>
                    <p className="limit">
                      <b>The catch.</b> {p.limit}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="runs" className="section steel" aria-labelledby="runs-title">
          <div className="hwrap">
            <Lines lines={['For whoever', 'sets it up']} id="runs-title" />
            <div className="three">
              <article data-reveal style={{ ['--d' as string]: '0ms' }}>
                <h3>Our shared service</h3>
                <p>
                  Cloudflare serves the app. Each kitchen gets its own Neon Postgres project, so one
                  kitchen’s heavy month is never another’s slow one.
                </p>
              </article>
              <article data-reveal style={{ ['--d' as string]: '90ms' }}>
                <h3>Your own storage</h3>
                <p>
                  Give us the connection address of an empty Postgres database, from any provider.
                  We install our tables, and remove only our tables if you ever go.
                </p>
              </article>
              <article data-reveal style={{ ['--d' as string]: '180ms' }}>
                <h3>Your own server</h3>
                <p>
                  One Docker command starts everything, with its own Postgres. Moving there is the
                  same single tap, with the same checks.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="hfoot" ref={close}>
        <svg className="wall" aria-hidden="true" focusable="false">
          <rect width="100%" height="100%" fill="url(#tiles)" />
        </svg>
        <div className="hwrap">
          <div className="foot-top">
            <p>
              Made for small kitchens that feed people they know, with nothing to hide on the way
              out.
            </p>
            <nav aria-label="Footer">
              <Link href={start}>{signedIn ? 'Your kitchens' : 'Sign in'}</Link>
              <a href="#try">Try it</a>
              <a href="#promises">Promises</a>
              <a href="#leaving">Leaving</a>
              <a href="/guides/">Guides</a>
              <a href="/docs/">Docs</a>
            </nav>
          </div>
          <ThemeSwitch className="foot-theme" />
          <p className="mega" aria-hidden="true" ref={name}>
            <span className="mega-base">Alimentation</span>
            <span className="mega-lit">Alimentation</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
