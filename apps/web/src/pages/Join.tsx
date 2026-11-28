import { MailPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ApiFailure, postJson } from "@/api";
import { NotAvailable, PageHeader, toast } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "../session.tsx";
import { OutsideLayout } from "./outside/Layout.tsx";

const KEY = "pending-invite";

/** Reading and keeping storage can fail (private windows); the link in the address bar is the truth. */
const keep = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (t: string) => {
    try {
      sessionStorage.setItem(KEY, t);
    } catch {
      /* the link still works from the address bar */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/**
 * Where an invitation link lands. The link's secret is in the address, either the part after `#` (which is not sent
 * to the server until it is used here) or `/join/:token`. A person who is signed out signs in first and is brought
 * back; the secret is kept for the round trip. Joining is a click, so opening a link never changes anything alone.
 */
export function Join() {
  const { me } = useSession();
  const [, go] = useLocation();
  const { token: param } = useParams<{ token?: string }>();
  const hash = window.location.hash.slice(1);
  const token = param || hash || keep.get();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | Error | null>(null);

  // Keep the secret across the sign-in page, which drops the part after #.
  useEffect(() => {
    if (param || hash) keep.set(param || hash);
  }, [param, hash]);

  const join = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const r = await postJson<{ slug: string }>("/api/invites/accept", { token });
      keep.clear();
      toast.success("You have joined the kitchen.");
      go(`/w/${r.slug}`, { replace: true });
    } catch (e) {
      setFailure(e instanceof Error ? e : new Error("That did not work. Try again."));
      setBusy(false);
    }
  };

  if (!token)
    return (
      <OutsideLayout width="max-w-xl">
        <NotAvailable
          title="This invite link is incomplete"
          backTo="/app"
          backLabel="Go to your kitchens"
        >
          Part of the link is missing. Ask your admin for a new one.
        </NotAvailable>
      </OutsideLayout>
    );

  if (failure instanceof ApiFailure && failure.code === "invite_invalid")
    return (
      <OutsideLayout width="max-w-xl">
        <NotAvailable title="This invite has expired" backTo="/app" backLabel="Go to your kitchens">
          This invite has expired. Ask your admin for a new one.
        </NotAvailable>
      </OutsideLayout>
    );

  return (
    <OutsideLayout width="max-w-md" centred>
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Join a kitchen"
          description="You were sent a link to join a kitchen."
          className="mb-0"
        />
        <Card>
          <CardHeader>
            <MailPlusIcon className="size-6 text-primary" aria-hidden="true" />
            <CardTitle>You have been invited</CardTitle>
            <CardDescription>
              Joining adds you to the kitchen with the role its admin chose for you. The link is for
              the email address it was sent to.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {failure ? (
              <Alert variant="destructive">
                <AlertDescription>{failure.message}</AlertDescription>
              </Alert>
            ) : null}
            {me === undefined ? (
              <Skeleton className="h-11 w-full" />
            ) : me?.account ? (
              <Button loading={busy} loadingText="Joining…" onClick={() => void join()}>
                Join
              </Button>
            ) : (
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={`/signin?next=${encodeURIComponent(param ? `/join/${param}` : "/join")}`}
                  />
                }
              >
                Sign in to join
              </Button>
            )}
            {me?.account ? (
              <p className="text-sm text-muted-foreground">
                Signed in as {me.account.email}. If that is not the address the link was sent to,
                sign out from the account menu and sign in with the right one.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </OutsideLayout>
  );
}
