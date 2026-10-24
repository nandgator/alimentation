import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { AppBar, RequireSignIn } from '../components/Chrome.tsx';
import { Problem } from '../components/ui.tsx';
import { postJson } from '../api.ts';

const KEY = 'pending-invite';

function Accept() {
  const [, go] = useLocation();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // The link's secret is in the part after #, which is never sent to the server until it is used here.
    const token = window.location.hash.slice(1) || sessionStorage.getItem(KEY) || '';
    sessionStorage.removeItem(KEY);
    if (!token) {
      setError('This invitation link is incomplete. Ask for a new one.');
      return;
    }
    postJson<{ slug: string }>('/api/invites/accept', { token }).then(
      (r) => go(`/w/${r.slug}`, { replace: true }),
      (e: Error) => setError(e.message),
    );
  }, [go]);
  return (
    <div className="narrow" style={{ padding: '64px 0' }}>
      <div className="card stack">
        <h1 style={{ fontSize: '1.8rem' }}>Joining your kitchen</h1>
        {error ? <Problem error={error} /> : <p className="muted">One moment…</p>}
      </div>
    </div>
  );
}

export function Join() {
  // Keep the secret across the sign-in page, which drops the part after #.
  if (window.location.hash.length > 1) sessionStorage.setItem(KEY, window.location.hash.slice(1));
  return (
    <>
      <AppBar />
      <RequireSignIn>
        <Accept />
      </RequireSignIn>
    </>
  );
}
