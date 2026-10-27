import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AppBar } from '../components/Chrome.tsx';
import { Field, Form, useAction } from '../components/ui.tsx';
import { postJson } from '../api.ts';
import { useSession } from '../session.tsx';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/app');

export function SignIn() {
  const { me, refresh } = useSession();
  const [, go] = useLocation();
  const next = safeNext(new URLSearchParams(useSearch()).get('next'));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const act = useAction();

  if (me?.account) {
    go(next, { replace: true });
    return null;
  }
  return (
    <>
      <AppBar />
      <div className="narrow solo">
        <div className="card stack" style={{ ['--gap' as string]: '18px' }}>
          <div>
            <p className="eyebrow">Welcome</p>
            <h1>Sign in</h1>
          </div>
          {me?.signInWithProvider ? (
            <a className="btn" href={`/auth/login?returnTo=${encodeURIComponent(next)}`}>
              Continue with your account
            </a>
          ) : null}
          {me?.authDev ? (
            <Form
              error={act.error}
              onSubmit={() =>
                act.run(async () => {
                  await postJson('/auth/dev-login', { email, name: name || undefined });
                  await refresh();
                })
              }
            >
              <div className="banner warn">
                Development sign-in: anyone can enter any email. It is off in production.
              </div>
              <Field label="Email" id="email">
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Name" id="name">
                <input
                  id="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <button className="btn" disabled={act.busy}>
                Sign in
              </button>
            </Form>
          ) : null}
          {me && !me.signInWithProvider && !me.authDev ? (
            <div className="banner bad">Sign-in is not set up on this server yet.</div>
          ) : null}
          <p className="muted small">
            <Link href="/">← Back to the home page</Link>
          </p>
        </div>
      </div>
    </>
  );
}
