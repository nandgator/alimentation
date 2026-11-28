// TODO(WP9, WP10): delete this file when its last importer (AppBar, Page) is gone; the shell no longer uses it.
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "../components/legacy/button.tsx";
import { useSession } from "../session.tsx";
import { Mark } from "./Mark.tsx";
import { PageHead } from "./ui.tsx";

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
      <div className={wide ? "wrap wide" : "wrap"}>
        {lead}
        <Link href={me?.account ? "/app" : "/"} className="brand">
          <Mark /> <span className="brand-text">Alimentation</span>
        </Link>
        <div className="grow" />
        {children}
        <a className="small helplink" href="/guides/">
          Help
        </a>
        {me?.account ? (
          <>
            <span className="muted small account who" title={me.account.email}>
              {me.account.name ?? me.account.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut().then(() => go("/"))}
              type="button"
            >
              Sign out
            </Button>
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

// The shell owns this now; the re-export keeps the pages outside a kitchen working until WP9 and WP10 replace this file's other exports.
export { RequireSignIn } from "../shell/RequireSignIn.tsx";
