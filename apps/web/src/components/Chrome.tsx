import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useSession } from '../session.tsx';
import { Mark } from './Mark.tsx';
import { PageHead } from './ui.tsx';

/** The bar across the top of every page that is not the home page. */
export function AppBar({
  children,
  wide,
  lead,
}: {
  children?: ReactNode;
  wide?: boolean;
  /** A control before the name, such as the button that opens a hidden menu. */
  lead?: ReactNode;
}) {
  const { me, signOut } = useSession();
  const [, go] = useLocation();
  return (
    <header className="topbar">
      <div className={wide ? 'wrap wide' : 'wrap'}>
        {lead}
        <Link href={me?.account ? '/app' : '/'} className="brand">
          <Mark /> <span className="brand-text">Alimentation</span>
        </Link>
        <div className="grow" />
        {children}
        <a className="small helplink" href="/docs/">
          Help
        </a>
        {me?.account ? (
          <>
            <span className="muted small account who" title={me.account.email}>
              {me.account.name ?? me.account.email}
            </span>
            <button
              className="btn ghost small"
              onClick={() => void signOut().then(() => go('/'))}
              type="button"
            >
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <div className="wrap">
        <PageHead title={title} actions={actions} />
        {children}
      </div>
    </div>
  );
}

/** For pages that need someone signed in: sends everyone else to sign in and brings them back. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [location, go] = useLocation();
  if (me === undefined)
    return (
      <p className="muted wrap" style={{ padding: 40 }}>
        Loading…
      </p>
    );
  if (!me?.account) {
    go(`/signin?next=${encodeURIComponent(location)}`, { replace: true });
    return null;
  }
  return <>{children}</>;
}
