import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useSession } from "../session.tsx";
import { ShellSkeleton } from "./ShellSkeleton.tsx";

/** For pages that need someone signed in: sends everyone else to sign in and brings them back. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [location, go] = useLocation();
  const signedOut = me !== undefined && !me?.account;
  useEffect(() => {
    if (signedOut)
      go(`/signin?next=${encodeURIComponent(location + window.location.search)}`, {
        replace: true,
      });
  }, [signedOut, location, go]);
  if (me === undefined) return <ShellSkeleton />;
  if (signedOut) return null;
  return <>{children}</>;
}
