import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import type { BootstrapDto, Role } from '@alimentation/core';
import { api, setActingAs } from '../../api.ts';
import { AppBar, RequireSignIn } from '../../components/Chrome.tsx';
import { Problem, Spinner, useLoad } from '../../components/ui.tsx';
import { Audit } from './Audit.tsx';
import { WorkspaceProvider, type Workspace } from './context.tsx';
import { Daily } from './Daily.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Holidays, Settlements, CloseMonths } from './Money.tsx';
import { LogPage } from './LogPage.tsx';
import { Payments } from './Payments.tsx';
import { People } from './People.tsx';
import { Rates } from './Rates.tsx';
import { YourData } from './YourData.tsx';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  supplier: 'Supplier',
  consumer: 'Member',
};

interface Item {
  to: string;
  label: string;
  roles: Role[];
}
const ITEMS: Item[] = [
  { to: '', label: 'Dashboard', roles: ['admin', 'supplier', 'consumer'] },
  { to: '/daily', label: 'Daily', roles: ['admin', 'supplier', 'consumer'] },
  { to: '/log', label: 'My log', roles: ['admin', 'supplier', 'consumer'] },
  { to: '/payments', label: 'Payments', roles: ['admin', 'supplier', 'consumer'] },
  { to: '/people', label: 'People', roles: ['admin'] },
  { to: '/rates', label: 'Rates & rules', roles: ['admin'] },
  { to: '/holidays', label: 'Holidays', roles: ['admin'] },
  { to: '/settlements', label: 'Settlements', roles: ['admin'] },
  { to: '/close', label: 'Month close', roles: ['admin'] },
  { to: '/audit', label: 'Audit', roles: ['admin'] },
  { to: '/data', label: 'Your data', roles: ['admin'] },
];

const roleKey = (slug: string) => `role:${slug}`;
/** On a phone the bar has room for this many; the rest sit behind “More”. */
const PRIMARY = 4;

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
  const items = ITEMS.filter((i) => i.roles.includes(role));
  const [more, setMore] = useState(false);
  // Choosing a section closes the panel of the rest.
  useEffect(() => setMore(false), [location]);
  const link = (i: Item) => {
    const href = `${base}${i.to}`;
    const here =
      i.to === '' ? location === base || location === `${base}/` : location.startsWith(href);
    return (
      <Link key={i.to} href={href} aria-current={here ? 'page' : undefined}>
        {i.label}
        {i.to === '/payments' && boot.pendingClaims > 0 && role !== 'consumer'
          ? ` (${boot.pendingClaims})`
          : ''}
      </Link>
    );
  };
  const moved = boot.workspace.state === 'MOVED';

  return (
    <WorkspaceProvider value={ws}>
      <AppBar>
        <span className="muted small who" aria-label="Kitchen">
          {boot.workspace.name}
        </span>
        {boot.roles.length > 1 ? (
          <label className="row" style={{ gap: 6 }}>
            <span className="sr">Acting as</span>
            <select
              aria-label="Acting as"
              style={{ width: 'auto', minHeight: 36, padding: '0.3rem 0.6rem' }}
              value={role}
              onChange={(e) => {
                localStorage.setItem(roleKey(slug), e.target.value);
                setActingAs(e.target.value);
                reload();
              }}
            >
              {boot.roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="chip">{ROLE_LABEL[role]}</span>
        )}
      </AppBar>
      <div className="subnav">
        <div className="wrap">
          <nav className="nav" aria-label="Sections" data-open={more}>
            {items.slice(0, PRIMARY).map(link)}
            {items.length > PRIMARY ? (
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
              {items.slice(PRIMARY).map(link)}
            </div>
          </nav>
        </div>
      </div>
      <div className="page" style={{ paddingTop: 16 }}>
        <div className="wrap">
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
          <div style={{ marginTop: 16 }}>
            <Switch>
              <Route path={base} component={Dashboard} />
              <Route path={`${base}/daily`} component={Daily} />
              <Route path={`${base}/log`} component={LogPage} />
              <Route path={`${base}/payments`} component={Payments} />
              {role === 'admin' ? <Route path={`${base}/people`} component={People} /> : null}
              {role === 'admin' ? <Route path={`${base}/rates`} component={Rates} /> : null}
              {role === 'admin' ? <Route path={`${base}/holidays`} component={Holidays} /> : null}
              {role === 'admin' ? (
                <Route path={`${base}/settlements`} component={Settlements} />
              ) : null}
              {role === 'admin' ? <Route path={`${base}/close`} component={CloseMonths} /> : null}
              {role === 'admin' ? <Route path={`${base}/audit`} component={Audit} /> : null}
              {role === 'admin' ? <Route path={`${base}/data`} component={YourData} /> : null}
              <Route>
                <p className="muted">There is nothing at this address for your role.</p>
              </Route>
            </Switch>
          </div>
          {fromDevice ? null : (
            <p className="muted small" style={{ marginTop: 32 }}>
              Times are in {boot.workspace.timeZone}. {boot.today}.
            </p>
          )}
        </div>
      </div>
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
          <div className="narrow" style={{ padding: '48px 0' }}>
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
            <p style={{ marginTop: 16 }}>
              <Link href="/app">← Your kitchens</Link>
            </p>
          </div>
        </>
      ) : !res.data ? (
        <>
          <AppBar />
          <div className="wrap" style={{ padding: 40 }}>
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
