import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { postJson } from "../api.ts";
import { AppBar } from "../components/Chrome.tsx";
import { Button } from "../components/legacy/button.tsx";
import { Input } from "../components/legacy/input.tsx";
import { Field, Form, useAction } from "../components/ui.tsx";
import { useSession } from "../session.tsx";

const safeNext = (n: string | null) => (n?.startsWith("/") && !n.startsWith("//") ? n : "/app");

export function SignIn() {
  const { me, refresh } = useSession();
  const [, go] = useLocation();
  const next = safeNext(new URLSearchParams(useSearch()).get("next"));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const act = useAction();

  if (me?.account) {
    go(next, { replace: true });
    return null;
  }
  return (
    <>
      <AppBar />
      <div className="narrow solo">
        <div className="card stack" style={{ ["--gap" as string]: "18px" }}>
          <div>
            <p className="eyebrow">Welcome</p>
            <h1>Sign in</h1>
          </div>
          {me?.signInWithProvider ? (
            <Button render={<a href={`/auth/login?returnTo=${encodeURIComponent(next)}`} />}>
              Continue with your account
            </Button>
          ) : null}
          {me?.authDev ? (
            <Form
              error={act.error}
              onSubmit={() =>
                act.run(async () => {
                  await postJson("/auth/dev-login", { email, name: name || undefined });
                  await refresh();
                })
              }
            >
              <div className="banner warn">
                Development sign-in: anyone can enter any email. It is off in production.
              </div>
              <Field label="Email" id="email">
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Name" id="name">
                <Input
                  id="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={act.busy}>
                Sign in
              </Button>
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
