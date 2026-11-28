import type {
  BootstrapDto,
  CatalogueItem,
  IsoDate,
  MenuVersion,
  RateCard,
  Service,
} from "@alimentation/core";
import { must } from "@alimentation/core";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, getJson, postJson } from "@/api";
import { AppForm, FormDialog, FormField, toast, useAppForm } from "@/components/app";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  applyPlan,
  type Outcome,
  type Plan,
  planCopy,
  type Snapshot,
  type What,
} from "../copySetup.ts";
import { CheckboxList } from "./outside/parts.tsx";

interface Kitchen {
  slug: string;
  name: string;
}

/** What a kitchen says about its prices, rules and holidays, to someone who is its admin. */
async function snapshot(slug: string): Promise<Snapshot> {
  const base = `/api/w/${slug}`;
  const boot = await api.get<BootstrapDto>(`${base}/bootstrap`);
  const money = boot.data.workspace.moneyEnabled;
  const [catalogue, services, menus, rateCards, policies] = await Promise.all([
    getJson<CatalogueItem[]>(`${base}/catalogue`),
    getJson<Service[]>(`${base}/services`),
    getJson<MenuVersion[]>(`${base}/menus`),
    money ? getJson<RateCard[]>(`${base}/rate-cards`) : Promise.resolve([] as RateCard[]),
    getJson<{ effectiveFrom: IsoDate; doc: unknown }[]>(`${base}/policies`),
  ]);
  return {
    today: boot.data.today,
    moneyEnabled: money,
    catalogue,
    services,
    menus,
    rateCards,
    policies,
    holidays: boot.data.holidays,
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WHAT = [
  { value: "menu", label: "Menu", hint: "What is served each day, with its services and items" },
  { value: "prices", label: "Prices", hint: "The price lists, between kitchens that track money" },
  { value: "rules", label: "Rules", hint: "Working days, leave and the rest" },
  { value: "holidays", label: "Holidays", hint: "From this month on" },
] as const;

const schema = z.object({
  from: z.string().min(1, "Choose the kitchen to copy from"),
  to: z.array(z.string()).min(1, "Choose at least one kitchen to copy to"),
  what: z.array(z.enum(["menu", "prices", "rules", "holidays"])).min(1, "Choose what to copy"),
});

const whatOf = (keys: readonly string[]): What => ({
  menu: keys.includes("menu"),
  prices: keys.includes("prices"),
  rules: keys.includes("rules"),
  holidays: keys.includes("holidays"),
});

function Summary({ plan }: { plan: Plan }) {
  const n = (k: Plan["steps"][number]["kind"]) => plan.steps.filter((s) => s.kind === k).length;
  const parts = [
    n("service") ? count(n("service"), "service") : "",
    n("item") ? count(n("item"), "item") : "",
    n("menu") ? count(n("menu"), "menu") : "",
    n("prices") ? count(n("prices"), "price list") : "",
    n("rules") ? count(n("rules"), "set of rules", "sets of rules") : "",
    n("holiday") ? count(n("holiday"), "holiday") : "",
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {plan.steps.length === 0 ? "Nothing to add." : `Will add ${parts.join(", ")}.`}{" "}
        {plan.already > 0 ? (
          <span className="text-muted-foreground">{plan.already} already the same.</span>
        ) : null}
      </p>
      {plan.steps.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {plan.steps.map((s) => (
            <li key={`${s.kind}-${s.label}`}>{s.label}</li>
          ))}
        </ul>
      ) : null}
      {plan.left.length > 0 ? (
        <Alert>
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>
            <p>Left as they are, because that kitchen has something different there:</p>
            <ul className="list-disc pl-5">
              {plan.left.map((l) => (
                <li key={l.label}>
                  {l.label}: {l.why}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {plan.notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

type Phase = "choose" | "preview" | "done";

/**
 * The menu, prices, rules and holidays from one kitchen to others, for someone who runs them all. It shows what would
 * be added before anything is, and adds it through each kitchen's own pages, so each kitchen still refuses what its
 * own rules refuse and the people in it are told nothing.
 */
export function CopySetupDialog({
  kitchens,
  open,
  onOpenChange,
}: {
  kitchens: Kitchen[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useAppForm(schema, {
    from: must(kitchens[0]).slug,
    to: [] as string[],
    what: ["menu", "prices", "rules", "holidays"] as ("menu" | "prices" | "rules" | "holidays")[],
  });
  const [phase, setPhase] = useState<Phase>("choose");
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const from = form.watch("from");
  const to = form.watch("to");
  const others = kitchens.filter((k) => k.slug !== from);
  const chosen = others.filter((k) => to.includes(k.slug));
  const nameOf = (slug: string) => kitchens.find((k) => k.slug === slug)?.name ?? slug;
  const anyToAdd = Object.values(plans).some((p) => p.steps.length > 0);

  // Changing a choice after looking means the look is out of date.
  useEffect(() => {
    const sub = form.watch((_v, info) => {
      if (info.name && phase !== "choose") {
        setPhase("choose");
        setPlans({});
        setDone({});
      }
    });
    return () => sub.unsubscribe();
  }, [form, phase]);

  // A kitchen that is the source cannot also be a target.
  useEffect(() => {
    if (to.includes(from))
      form.setValue(
        "to",
        to.filter((s) => s !== from),
      );
  }, [from, to, form]);

  const submitLabel =
    phase === "choose"
      ? "See what would be added"
      : phase === "preview"
        ? `Copy to ${count(chosen.length, "kitchen")}`
        : "Done";

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPhase("choose");
          setPlans({});
          setDone({});
        }
      }}
      title="Copy a setup"
      description="Take the menu, prices, rules and holidays from one kitchen you run and add them to others you run. You see what would be added first, and nothing already there is changed."
      formId="copy-setup-form"
      submitLabel={submitLabel}
      busyLabel={phase === "preview" ? "Copying…" : "Looking…"}
      submitting={form.formState.isSubmitting}
      submitDisabled={phase === "preview" && !anyToAdd}
      cancelLabel={phase === "done" ? "Close" : "Cancel"}
      dirty={form.formState.isDirty && phase !== "done"}
      onDiscard={() => form.reset()}
    >
      <AppForm
        id="copy-setup-form"
        form={form}
        onSubmit={async (v) => {
          if (phase === "done") {
            onOpenChange(false);
            return;
          }
          if (phase === "choose") {
            const source = await snapshot(v.from);
            const next: Record<string, Plan> = {};
            for (const k of others.filter((o) => v.to.includes(o.slug)))
              next[k.slug] = planCopy(source, await snapshot(k.slug), whatOf(v.what));
            setPlans(next);
            setPhase("preview");
            return;
          }
          const results: Record<string, Outcome> = {};
          for (const k of chosen) {
            const plan = plans[k.slug];
            if (plan && plan.steps.length > 0)
              results[k.slug] = await applyPlan(
                (path, body) => postJson(path, body),
                `/api/w/${k.slug}`,
                plan.steps,
                (path) => getJson(path),
              );
          }
          setDone(results);
          setPhase("done");
          const added = Object.values(results).reduce((a, r) => a + r.added, 0);
          const refused = Object.values(results).reduce((a, r) => a + r.refused.length, 0);
          if (refused) toast.error(`Added ${added}; ${refused} refused.`);
          else toast.success(`Added ${added}.`);
        }}
      >
        {phase === "done" ? null : (
          <>
            <FormField name="from" label="Copy from" required>
              {(f) => (
                <NativeSelect {...f} className="w-full">
                  {kitchens.map((k) => (
                    <NativeSelectOption key={k.slug} value={k.slug}>
                      {k.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField name="to" label="Copy to" required>
              {(f) => (
                <CheckboxList
                  id={f.id}
                  label="Copy to"
                  options={others.map((k) => ({ value: k.slug, label: k.name }))}
                  value={f.value}
                  onChange={f.onChange}
                  invalid={!!f["aria-invalid"]}
                  describedBy={f["aria-describedby"]}
                />
              )}
            </FormField>
            <FormField name="what" label="What to copy" required>
              {(f) => (
                <CheckboxList
                  id={f.id}
                  label="What to copy"
                  options={[...WHAT]}
                  value={f.value}
                  onChange={f.onChange}
                  invalid={!!f["aria-invalid"]}
                  describedBy={f["aria-describedby"]}
                />
              )}
            </FormField>
          </>
        )}

        {phase === "preview" ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            {chosen.map((k) => (
              <section key={k.slug} className="flex flex-col gap-2" aria-label={k.name}>
                <h3 className="text-sm font-semibold">{k.name}</h3>
                {plans[k.slug] ? <Summary plan={must(plans[k.slug])} /> : null}
              </section>
            ))}
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            {Object.keys(done).length === 0 ? <p className="text-sm">Nothing was added.</p> : null}
            {Object.entries(done).map(([slug, r]) => (
              <section key={slug} className="flex flex-col gap-2" aria-label={nameOf(slug)}>
                <h3 className="text-sm font-semibold">{nameOf(slug)}</h3>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-muted text-foreground">
                    <CheckIcon aria-hidden="true" /> Added {r.added}
                  </Badge>
                  {r.refused.length > 0 ? (
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      <CircleAlertIcon aria-hidden="true" /> {r.refused.length} refused
                    </Badge>
                  ) : null}
                </div>
                {r.refused.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm">
                    {r.refused.map((x) => (
                      <li key={x.label}>
                        {x.label}: {x.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}
      </AppForm>
    </FormDialog>
  );
}
