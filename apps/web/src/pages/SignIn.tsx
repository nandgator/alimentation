import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { z } from "zod";
import { postJson } from "@/api";
import { AppForm, FormField, PageHeader, SubmitButton, useAppForm } from "@/components/app";
import { Mark } from "@/components/Mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "../session.tsx";
import { OutsideLayout } from "./outside/Layout.tsx";

const safeNext = (n: string | null) => (n?.startsWith("/") && !n.startsWith("//") ? n : "/app");

const emailSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("That does not look like an email"),
});
const nameSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120, "Keep your name under 120 characters"),
});

type Step = { at: "email" } | { at: "name"; email: string };

/** The sign-in used while developing: any email, no password. Asks for a name only when the account has none. */
function DevSignIn() {
  const { refresh } = useSession();
  const [step, setStep] = useState<Step>({ at: "email" });
  const emailForm = useAppForm(emailSchema, { email: "" });
  const nameForm = useAppForm(nameSchema, { name: "" });

  if (step.at === "name")
    return (
      <AppForm
        form={nameForm}
        onSubmit={async (v) => {
          await postJson("/auth/dev-login", { email: step.email, name: v.name });
          await refresh();
        }}
      >
        <p className="text-sm text-muted-foreground">
          This is a new account for {step.email}. What should people in your kitchen call you?
        </p>
        <FormField name="name" label="Your name" required>
          {(f) => <Input {...f} autoComplete="name" autoFocus maxLength={120} />}
        </FormField>
        <SubmitButton busy="Signing in…" className="w-full">
          Continue
        </SubmitButton>
      </AppForm>
    );

  return (
    <AppForm
      form={emailForm}
      onSubmit={async (v) => {
        const r = await postJson<{ account: { name: string | null } }>("/auth/dev-login", {
          email: v.email,
        });
        // A name is asked for only when the account has none yet; everyone else is in.
        if (r.account.name) await refresh();
        else setStep({ at: "name", email: v.email });
      }}
    >
      <Alert>
        <AlertDescription>
          Development sign-in: anyone can enter any email. It is off in production.
        </AlertDescription>
      </Alert>
      <FormField name="email" label="Email" required>
        {(f) => (
          <Input
            {...f}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="email"
          />
        )}
      </FormField>
      <SubmitButton busy="Signing in…" className="w-full">
        Continue
      </SubmitButton>
    </AppForm>
  );
}

export function SignIn() {
  const { me } = useSession();
  const [, go] = useLocation();
  const next = safeNext(new URLSearchParams(useSearch()).get("next"));
  const signedIn = !!me?.account;
  useEffect(() => {
    if (signedIn) go(next, { replace: true });
  }, [signedIn, next, go]);
  if (signedIn) return null;
  return (
    <OutsideLayout width="max-w-md" centred>
      <div className="flex w-full flex-col items-stretch gap-4">
        <div className="flex justify-center text-primary">
          <Mark size={40} />
        </div>
        <PageHeader
          title="Sign in"
          description="Use the email your kitchen knows you by."
          centred
          className="mb-0"
        />
        <Card>
          <CardContent className="flex flex-col gap-5">
            {me?.signInWithProvider ? (
              <Button
                size="lg"
                nativeButton={false}
                render={<a href={`/auth/login?returnTo=${encodeURIComponent(next)}`} />}
              >
                Continue with your account
              </Button>
            ) : null}
            {me?.authDev ? <DevSignIn /> : null}
            {me && !me.signInWithProvider && !me.authDev ? (
              <Alert variant="destructive">
                <AlertDescription>Sign-in is not set up on this server yet.</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            Back to the home page
          </Link>
        </p>
      </div>
    </OutsideLayout>
  );
}
