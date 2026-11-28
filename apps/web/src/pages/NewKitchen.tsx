import { ArrowLeftIcon, CheckIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { api, getJson, postJson } from "@/api";
import {
  AppForm,
  EmptyState,
  FormField,
  PageHeader,
  SubmitButton,
  toast,
  useAppForm,
} from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Capacity } from "../api.ts";
import { useSession } from "../session.tsx";
import { applyStarter, STARTERS } from "../starters.ts";
import { OutsideLayout, SignedIn } from "./outside/Layout.tsx";
import { RadioCards, sayError, useLoad } from "./outside/parts.tsx";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** What is typed into the address: lower case, dashes for anything else, and the ends left alone so a dash can be typed. */
const tidy = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free" }
  | { state: "taken"; reason: string; suggestion: string | null }
  | { state: "unknown" };

/**
 * Asks whether an address is free as it is typed (FRM-09), a third of a second after the last key, so the answer is
 * there before the button is pressed. A failed check says nothing is known and leaves the decision to the submit.
 */
function useAddressCheck(slug: string): Check {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  useEffect(() => {
    if (slug.length < 3) {
      setCheck({ state: "idle" });
      return;
    }
    setCheck({ state: "checking" });
    let live = true;
    const timer = setTimeout(() => {
      getJson<{ available: boolean; reason?: string; suggestion?: string | null }>(
        `/api/workspaces/address/${encodeURIComponent(slug)}`,
      ).then(
        (r) => {
          if (live)
            setCheck(
              r.available
                ? { state: "free" }
                : {
                    state: "taken",
                    reason: r.reason ?? "That address is taken.",
                    suggestion: r.suggestion ?? null,
                  },
            );
        },
        () => live && setCheck({ state: "unknown" }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug]);
  return check;
}

function AddressStatus({
  check,
  slug,
  onUse,
}: {
  check: Check;
  slug: string;
  onUse: (s: string) => void;
}) {
  return (
    <span aria-live="polite" className="flex flex-col gap-1">
      <span>
        Letters, numbers and dashes. The link will be{" "}
        <span className="font-mono">/w/{slug || "…"}</span>
      </span>
      {check.state === "checking" ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner className="size-3.5" aria-hidden="true" /> Checking…
        </span>
      ) : null}
      {check.state === "free" ? (
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <CheckIcon className="size-3.5" aria-hidden="true" /> Available
        </span>
      ) : null}
      {check.state === "taken" ? (
        <span className="flex flex-wrap items-center gap-x-1.5 font-medium text-destructive">
          <CircleAlertIcon className="size-3.5" aria-hidden="true" />
          {check.suggestion ? (
            <>
              Taken. Try{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => onUse(check.suggestion ?? "")}
              >
                {check.suggestion}
              </Button>
              .
            </>
          ) : (
            check.reason
          )}
        </span>
      ) : null}
    </span>
  );
}

/** Where kitchens are by invitation: what that means, and a way to ask. */
function AskForAPlace({ requested }: { requested: boolean }) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        New kitchens here are by invitation, to keep the service from filling up. Ask for a place
        with the email you signed in with, and whoever runs the service will approve it. Come back
        here once they have: this page will then let you start your kitchen.
      </p>
      {requested ? (
        <Alert role="status">
          <AlertDescription>
            You have asked for a place. There is nothing more to do until it is approved.
          </AlertDescription>
        </Alert>
      ) : (
        <Button
          type="button"
          className="self-start"
          loading={busy}
          loadingText="Asking…"
          onClick={() => {
            setBusy(true);
            setError(null);
            postJson("/api/waitlist")
              .then(async () => {
                await refresh();
                toast.success("Asked. You will be able to start a kitchen once it is approved.");
              })
              .catch((e) => setError(sayError(e)))
              .finally(() => setBusy(false));
          }}
        >
          Ask for a place
        </Button>
      )}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

const MONEY = [
  {
    value: "track",
    title: "Track money: bills, payments and balances",
    description:
      "You set prices, each person gets a bill each month, and payments are recorded and confirmed.",
  },
  {
    value: "meals",
    title: "Meals only: no money, can't be turned on later",
    description:
      "The kitchen only counts meals: who ate, who was on leave, and the extras as numbers. There are no prices, bills or payments.",
  },
] as const;

const base = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the kitchen a name")
    .max(120, "Keep the name under 120 characters"),
  slug: z
    .string()
    .min(3, "Use at least 3 letters, digits or dashes")
    .max(40, "Use at most 40 letters, digits or dashes")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      "Use lowercase letters, digits and dashes, starting and ending with a letter or digit",
    ),
  supplier: z.boolean(),
  starter: z.string().min(1, "Choose what to start from"),
});
/** The money choice has no default: where it is asked, the form will not go on until one is picked. */
const schemaFor = (asked: boolean) =>
  base.extend({
    money: asked
      ? z.enum(["track", "meals"], "Choose whether this kitchen tracks money")
      : z.string(),
  });

function Form({ cap, moneyAllowed }: { cap: Capacity | null; moneyAllowed: boolean }) {
  const [, go] = useLocation();
  const { refresh } = useSession();
  const form = useAppForm(schemaFor(moneyAllowed), {
    name: "",
    slug: "",
    supplier: true,
    starter: STARTERS[0]?.id ?? "blank",
    money: "" as never,
  });
  const slugEdited = useRef(false);
  const slug = form.watch("slug");
  const check = useAddressCheck(slug);
  const checkRef = useRef(check);
  checkRef.current = check;
  const full = cap ? !cap.open && !cap.dedicated : false;
  return (
    <AppForm
      form={form}
      serverFields={{ slug_taken: "slug" }}
      onSubmit={async (v) => {
        const c = checkRef.current;
        if (c.state === "taken") {
          form.setError(
            "slug",
            {
              message: c.suggestion ? `Taken. Try ${c.suggestion}.` : c.reason,
            },
            { shouldFocus: true },
          );
          return;
        }
        const made = await postJson<{ slug: string }>("/api/workspaces", {
          slug: v.slug,
          name: v.name,
          alsoSupplier: v.supplier,
          moneyEnabled: moneyAllowed ? v.money === "track" : false,
        });
        // The starter is set up with the same calls as by hand. If one fails the kitchen is still made.
        const chosen = STARTERS.find((x) => x.id === v.starter);
        if (chosen) {
          const base = `/api/w/${made.slug}`;
          await applyStarter(
            {
              get: (path) => getJson(path),
              post: (path, body) => postJson(path, body),
              patch: (path, body) => api.patch(path, body),
            },
            base,
            chosen,
          ).catch(() =>
            toast.error(
              "The kitchen is made, but its starting menu could not be added. Add it under Menu.",
            ),
          );
        }
        await refresh();
        go(`/w/${made.slug}`);
      }}
    >
      {full ? (
        <Alert>
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>
            The free places are full for now. You can try again later, or run your own instance and
            move in.
          </AlertDescription>
        </Alert>
      ) : null}
      <FormField name="name" label="Name" required description="What your people call it.">
        {(f) => (
          <Input
            {...f}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => {
              f.onChange(e);
              // The address follows the name until the person writes their own.
              if (!slugEdited.current)
                form.setValue("slug", slugify(e.target.value), { shouldDirty: true });
            }}
          />
        )}
      </FormField>
      <FormField
        name="slug"
        label="Address"
        required
        description={
          <AddressStatus
            check={check}
            slug={slug}
            onUse={(s) => {
              slugEdited.current = true;
              form.setValue("slug", s, { shouldDirty: true, shouldTouch: true });
            }}
          />
        }
      >
        {(f) => (
          <Input
            {...f}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              slugEdited.current = true;
              f.onChange(tidy(e.target.value));
            }}
          />
        )}
      </FormField>
      <Controller
        control={form.control}
        name="supplier"
        render={({ field }) => (
          <Field orientation="horizontal">
            <Checkbox
              id="supplier"
              checked={field.value}
              onCheckedChange={(on) => field.onChange(on === true)}
            />
            <FieldLabel htmlFor="supplier" className="font-normal">
              I also cook for them (add me as the cook too)
            </FieldLabel>
          </Field>
        )}
      />
      <FormField name="starter" label="Start from">
        {(f) => (
          <RadioCards
            id={f.id}
            label="Start from"
            options={STARTERS.map((x) => ({ value: x.id, title: x.title, description: x.about }))}
            value={f.value}
            onChange={f.onChange}
            onBlur={f.onBlur}
            invalid={!!f["aria-invalid"]}
            describedBy={f["aria-describedby"]}
          />
        )}
      </FormField>
      {moneyAllowed ? (
        <FormField
          name="money"
          label="Prices and bills"
          required
          description={<strong>You choose this once, now. It cannot be changed later.</strong>}
        >
          {(f) => (
            <RadioCards
              id={f.id}
              label="Prices and bills"
              options={MONEY}
              value={f.value}
              onChange={f.onChange}
              onBlur={f.onBlur}
              invalid={!!f["aria-invalid"]}
              describedBy={f["aria-describedby"]}
            />
          )}
        </FormField>
      ) : (
        <p className="text-sm text-muted-foreground">
          This service keeps kitchens to counting meals. There are no prices, bills or payments
          here.
        </p>
      )}
      <SubmitButton busy="Creating…" className="w-full sm:w-auto sm:self-start" disabled={full}>
        Create kitchen
      </SubmitButton>
    </AppForm>
  );
}

/** `/app/new`: one column, one thing to do. What stops a new kitchen (a closed service, an invitation, a limit) is said instead of a form. */
export function NewKitchen() {
  const { me } = useSession();
  const cap = useLoad<Capacity>("/api/public/capacity");
  const refusal = me?.signup?.refusal ?? null;
  const dedicated = cap.data?.dedicated && !me?.operator;
  return (
    <OutsideLayout width="max-w-xl">
      <SignedIn skeleton="form">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          nativeButton={false}
          render={<Link href="/app" />}
        >
          <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
          Your kitchens
        </Button>
        <PageHeader
          title="New kitchen"
          description="A name, what to start from, and whether it tracks money."
        />
        {dedicated ? (
          <EmptyState
            title="This is a private instance"
            description="Ask whoever runs it to add a kitchen for you."
          />
        ) : refusal === "closed" ? (
          <Alert>
            <AlertDescription>
              This service is not taking new kitchens right now. You can run your own instance and
              move in later.
            </AlertDescription>
          </Alert>
        ) : refusal === "invite_only" ? (
          <AskForAPlace requested={me?.signup?.requested ?? false} />
        ) : refusal === "limit" ? (
          <Alert>
            <AlertDescription>
              You already have the most kitchens one account can start here (
              {me?.signup?.maxWorkspaces}). Delete one you no longer use, or run your own instance
              and move in.
            </AlertDescription>
          </Alert>
        ) : (
          <Form cap={cap.data ?? null} moneyAllowed={me?.moneyAllowed !== false} />
        )}
      </SignedIn>
    </OutsideLayout>
  );
}
