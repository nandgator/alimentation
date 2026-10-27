import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import type { BootstrapDto, Role } from '@alimentation/core';
import { api, setActingAs } from '../../api.ts';
import { AppBar, RequireSignIn } from '../../components/Chrome.tsx';
import { Problem, Spinner, useLoad } from '../../components/ui.tsx';
import { useMedia } from '../../home/motion.tsx';
import { Audit } from './Audit.tsx';
import { WorkspaceProvider, type Workspace } from './context.tsx';
import { Daily } from './Daily.tsx';
import { Dashboard } from './Dashboard.tsx';
import { History } from './History.tsx';
import { Holidays, Settlements, CloseMonths } from './Money.tsx';
import { LogPage } from './LogPage.tsx';
import { Payments } from './Payments.tsx';
import { People } from './People.tsx';
import { Rates } from './Rates.tsx';
import {
  groupsFor,
  hrefOf,
  isHere,
  sectionsFor,
  type Section,
  type SectionKey,
} from './sections.ts';
import { YourData } from './YourData.tsx';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  supplier: 'Supplier',
  consumer: 'Member',
};

/** What each screen shows. Adding a screen to the list without adding it here is a type error. */
const VIEW: Record<SectionKey, ComponentType> = {
  dashboard: Dashboard,
  daily: Daily,
  log: LogPage,
  payments: Payments,
  history: History,
  people: People,
  rates: Rates,
  holidays: Holidays,
  settlements: Settlements,
  close: CloseMonths,
  audit: Audit,
  data: YourData,
};

const roleKey = (slug: string) => `role:${slug}`;
const PINNED_KEY = 'menu:pinned';
/** Whether the menu stays beside the page on a wide screen. A choice that belongs to the device. */
function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) !== 'no';
  } catch {
    return true;
  }
}
function writePinned(pinned: boolean) {
  try {
    localStorage.setItem(PINNED_KEY, pinned ? 'yes' : 'no');
  } catch {
    // The choice then lasts only until the page is closed.
  }
}
/** On a phone the bar has room for this many; the rest sit behind “More”. */
const PRIMARY = 4;
/** From this width the menu is a column beside the page instead of a row above it. */
const SIDEBAR = '(min-width: 960px)';

/** Who you are acting as in this kitchen: a switch for someone who holds more than one role. */
function Acting({
  roles,
  role,
  slug,
  reload,
}: {
  roles: Role[];
  role: Role;
  slug: string;
  reload: () => void;
}) {
  return roles.length > 1 ? (
    <label className="acting">
      <span>Acting as</span>
      <select
        value={role}
        onChange={(e) => {
          localStorage.setItem(roleKey(slug), e.target.value);
          setActingAs(e.target.value);
          reload();
        }}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <span className="chip">{ROLE_LABEL[role]}</span>
  );
}

function NavLink({
  base,
  section,
  location,
  waiting,
}: {
  base: string;
  section: Section;
  location: string;
  waiting: number;
}) {
  return (
    <Link
      href={hrefOf(base, section)}
      aria-current={isHere(base, section, location) ? 'page' : undefined}
    >
      {section.label}
      {section.key === 'payments' && waiting > 0 ? (
        <span className="count">
          <span className="sr">, </span>
          {waiting}
          <span className="sr"> to confirm</span>
        </span>
      ) : null}
    </Link>
  );
}

function Loaded({
  slug,
  boot,
  fromDevice,
  reload,
}: {
  slug: string;
  boot: BootstrapDto;
  fromDevice: boolean;
  reload: () => void;
}) {
  const [location] = useLocation();
  const wide = useMedia(SIDEBAR);
  const base = `/w/${slug}`;
  const role = boot.me.role;
  const people = useMemo(() => new Map(boot.people.map((p) => [p.id, p.name])), [boot.people]);
  const ws: Workspace = {
    slug,
    boot,
    role,
    writable: boot.workspace.state === 'ACTIVE',
    fromDevice,
    api: `/api/w/${slug}`,
    reload,
    nameOf: (id) => people.get(id) ?? 'Someone',
  };
  const mine = sectionsFor(role);
  const [more, setMore] = useState(false);
  const [pinned, setPinned] = useState(readPinned);
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const side = useRef<HTMLElement>(null);
  // Choosing a section closes the panel of the rest, and the menu that was hiding.
  useEffect(() => {
    setMore(false);
    setDrawer(false);
  }, [location]);
  // A hidden menu that is open takes focus, and gives it back when it closes.
  useEffect(() => {
    if (!drawer) return;
    side.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDrawer(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);
  const setPin = (value: boolean) => {
    setPinned(value);
    writePinned(value);
    setDrawer(false);
  };
  // A role that sees only the everyday group needs no group heading to tell them apart.
  const groups = groupsFor(role);
  const waiting = role === 'consumer' ? 0 : boot.pendingClaims;
  // What does not fit in the bar goes behind More, still in its groups.
  const rest = mine.slice(PRIMARY);
  const restGroups = groups
    .map((g) => ({ ...g, sections: g.sections.filter((s) => rest.includes(s)) }))
    .filter((g) => g.sections.length > 0);
  const link = (s: Section) => (
    <NavLink key={s.key} base={base} section={s} location={location} waiting={waiting} />
  );
  const moved = boot.workspace.state === 'MOVED';
  const acting = <Acting roles={boot.roles} role={role} slug={slug} reload={reload} />;

  const content = (
    <>
      {fromDevice ? (
        <div className="banner info" role="status">
          You are offline. This is the last statement saved on this device.
        </div>
      ) : null}
      {boot.workspace.state === 'MIGRATING' ? (
        <div className="banner warn" role="status">
          This kitchen is being moved. It is read-only until the move finishes.
        </div>
      ) : null}
      {moved ? (
        <div className="banner warn" role="status">
          This kitchen has moved
          {boot.workspace.movedTo ? (
            <>
              {' '}
              to <a href={boot.workspace.movedTo}>{boot.workspace.movedTo}</a>
            </>
          ) : null}
          . This copy is read-only and will be removed.
        </div>
      ) : null}
      {boot.setup.map((s) => (
        <div key={s.code} className="banner info">
          {s.message}
          {role === 'admin' && s.code === 'rate_card' ? (
            <Link href={`${base}/rates`}>Add one</Link>
          ) : null}
          {role === 'admin' && s.code === 'consumers' ? (
            <Link href={`${base}/people`}>Add people</Link>
          ) : null}
        </div>
      ))}
      <div className="view">
        <Switch>
          {mine.map((s) => (
            <Route key={s.key} path={hrefOf(base, s)} component={VIEW[s.key]} />
          ))}
          <Route>
            <p className="muted">There is nothing at this address for your role.</p>
          </Route>
        </Switch>
      </div>
      {fromDevice ? null : (
        <p className="muted small foot">
          Times are in {boot.workspace.timeZone}. {boot.today}.
        </p>
      )}
    </>
  );

  return (
    <WorkspaceProvider value={ws}>
      {wide ? (
        <>
          <AppBar
            wide
            lead={
              pinned ? null : (
                <button
                  ref={menuButton}
                  type="button"
                  className="btn ghost small menu-toggle"
                  aria-expanded={drawer}
                  aria-controls="side"
                  onClick={() => setDrawer((d) => !d)}
                >
                  Menu
                </button>
              )
            }
          />
          <div className="shell" data-pinned={pinned}>
            {pinned ? null : (
              <div
                className="side-backdrop"
                data-open={drawer}
                aria-hidden="true"
                onClick={() => setDrawer(false)}
              />
            )}
            <aside
              id="side"
              ref={side}
              className="side"
              data-open={drawer}
              inert={!pinned && !drawer}
            >
              <div className="kitchen">
                <p className="kitchen-name" aria-label="Kitchen">
                  {boot.workspace.name}
                </p>
                {acting}
              </div>
              <button type="button" className="quiet side-pin" onClick={() => setPin(!pinned)}>
                {pinned ? 'Hide this menu' : 'Keep this menu open'}
              </button>
              <nav aria-label="Sections">
                {groups.map((g) => (
                  <div key={g.key} role="group" aria-label={g.label} className="side-group">
                    {groups.length > 1 ? (
                      <p className="side-title" aria-hidden="true">
                        {g.label}
                      </p>
                    ) : null}
                    {g.sections.map(link)}
                  </div>
                ))}
              </nav>
            </aside>
            <main className="page">{content}</main>
          </div>
        </>
      ) : (
        <>
          <AppBar>
            <span className="muted small who" aria-label="Kitchen" title={boot.workspace.name}>
              {boot.workspace.name}
            </span>
            {acting}
          </AppBar>
          <div className="subnav">
            <div className="wrap">
              <nav className="nav" aria-label="Sections" data-open={more}>
                {mine.slice(0, PRIMARY).map(link)}
                {mine.length > PRIMARY ? (
                  <button
                    type="button"
                    className="more"
                    aria-expanded={more}
                    aria-controls="more-links"
                    onClick={() => setMore((m) => !m)}
                  >
                    More
                  </button>
                ) : null}
                <div id="more-links" className="extras">
                  {restGroups.map((g) => (
                    <div key={g.key} role="group" aria-label={g.label} className="extras-group">
                      {restGroups.length > 1 ? (
                        <p className="side-title" aria-hidden="true">
                          {g.label}
                        </p>
                      ) : null}
                      {g.sections.map(link)}
                    </div>
                  ))}
                  <a className="extras-help" href="/guides/">
                    Help and guides
                  </a>
                </div>
              </nav>
            </div>
          </div>
          <main className="page">
            <div className="wrap">{content}</div>
          </main>
        </>
      )}
    </WorkspaceProvider>
  );
}

export function WorkspaceShell() {
  const { slug = '' } = useParams();
  const [ready, setReady] = useState(false);
  // Remember which role this person last acted as in this kitchen.
  useEffect(() => {
    setActingAs(localStorage.getItem(roleKey(slug)));
    setReady(true);
    return () => setActingAs(null);
  }, [slug]);
  const res = useLoad(
    () =>
      ready
        ? api.get<BootstrapDto>(`/api/w/${slug}/bootstrap`)
        : new Promise<never>(() => undefined),
    [slug, ready],
  );
  return (
    <RequireSignIn>
      {res.error && !res.data ? (
        <>
          <AppBar />
          <div className="narrow solo">
            <Problem
              error={
                res.error.status === 404
                  ? 'There is no kitchen at this address, or you are not in it.'
                  : res.error.status === 410
                    ? 'This kitchen has been deleted.'
                    : res.error.status === 403
                      ? 'You are not a member of this kitchen.'
                      : res.error
              }
            />
            <p>
              <Link href="/app">← Your kitchens</Link>
            </p>
          </div>
        </>
      ) : !res.data ? (
        <>
          <AppBar />
          <div className="wrap waiting">
            <Spinner />
          </div>
        </>
      ) : (
        <Loaded
          slug={slug}
          boot={res.data.data}
          fromDevice={res.data.fromDevice}
          reload={res.reload}
        />
      )}
    </RequireSignIn>
  );
}
