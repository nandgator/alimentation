import type { BootstrapDto } from "@alimentation/core";
import { LandmarkIcon, PlusIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "wouter";
import { api } from "@/api";
import { EmptyState, Money, PageHeader, StatusBadge } from "@/components/app";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { figuresOf, isRunning, type KitchenFigures, totalsOf } from "../kitchens.ts";
import { useSession } from "../session.tsx";
import { initials } from "../shell/account.tsx";
import { OutsideLayout, SignedIn } from "./outside/Layout.tsx";
import { StatCard } from "./workspace/bills/StatCard.tsx";

// Needed only by someone who runs several kitchens, so everyone else does not download it.
const ManyKitchens = lazy(() =>
  import("./ManyKitchens.tsx").then((m) => ({ default: m.ManyKitchens })),
);

type Found = Record<string, KitchenFigures | "failed">;

/**
 * Asks each of the person's kitchens, a few at a time, what it would tell them on opening it. Each question
 * is an ordinary request as that person in that kitchen, so a kitchen answers only what it would anyway, and
 * counts the request against its own budget.
 */
function useFigures(slugs: string[]): Found {
  const [found, setFound] = useState<Found>({});
  const key = slugs.join(",");
  useEffect(() => {
    let live = true;
    const queue = key ? key.split(",") : [];
    const worker = async () => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        const mine = slug;
        const result = await api.get<BootstrapDto>(`/api/w/${mine}/bootstrap`).then(
          (r) => figuresOf(r.data, r.fromDevice),
          () => "failed" as const,
        );
        if (live) setFound((f) => ({ ...f, [mine]: result }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return () => {
      live = false;
    };
  }, [key]);
  return found;
}

/** What a kitchen would say on opening it, in a line: what is owed, what waits, what is not set up. */
function Figures({ f }: { f: KitchenFigures | "failed" | undefined }) {
  if (f === undefined) return <Skeleton className="h-4 w-40" />;
  if (f === "failed")
    return <span className="text-muted-foreground">The figures could not be read just now.</span>;
  const h = f.headline;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {!f.moneyEnabled ? (
        <span>{f.meals} meals this month</span>
      ) : isRunning(f.role) ? (
        h.owed > 0 ? (
          <span>
            <Money paise={h.owed} /> owed
          </span>
        ) : (
          <span>Nothing owed</span>
        )
      ) : h.owed > 0 ? (
        <span>
          You owe <Money paise={h.owed} />
        </span>
      ) : (
        <span>You owe nothing</span>
      )}
      {f.moneyEnabled && isRunning(f.role) && h.toConfirm > 0 ? (
        <StatusBadge status="pending" label={`${h.toConfirm} to confirm`} />
      ) : null}
      {f.setup > 0 ? <StatusBadge status="pending" label="Needs setting up" /> : null}
      {f.fromDevice ? <Badge variant="secondary">Saved on this device</Badge> : null}
    </span>
  );
}

const ROLE = { admin: "Admin", supplier: "Cook", consumer: "Consumer" } as const;

export function Places() {
  const { me } = useSession();
  const list = me?.workspaces ?? [];
  const active = list.filter((w) => w.state === "ACTIVE");
  const adminOf = active.filter((w) => w.roles.includes("admin"));
  const organisations = me?.organisations ?? [];
  // Figures beside each kitchen are for someone with several of them. With one there is nothing to compare,
  // so nothing is asked of it here, and it is asked once, when it is opened.
  const several = active.length >= 2;
  const figures = useFigures(several ? active.map((w) => w.slug) : []);
  const counted = Object.values(figures).filter((f): f is KitchenFigures => f !== "failed");
  const totals =
    several && counted.length === Object.keys(figures).length && counted.length === active.length
      ? totalsOf(counted)
      : null;
  const runsMany = adminOf.length >= 2 || organisations.length > 0 || !!me?.operator;
  const [privateInstance, setPrivate] = useState(false);
  useEffect(() => {
    api.get<{ dedicated: boolean }>("/api/public/capacity").then(
      (r) => setPrivate(r.data.dedicated),
      () => setPrivate(false),
    );
  }, []);
  const mayStart = !(privateInstance && !me?.operator);
  const newKitchen = (
    <Button nativeButton={false} render={<Link href="/app/new" />}>
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      New kitchen
    </Button>
  );
  return (
    <OutsideLayout>
      <SignedIn>
        <PageHeader
          title="Your kitchens"
          actions={
            <>
              {runsMany ? (
                <Suspense fallback={null}>
                  <ManyKitchens kitchens={adminOf} organisations={organisations.length} />
                </Suspense>
              ) : null}
              {mayStart ? newKitchen : null}
            </>
          }
        />
        <div className="flex flex-col gap-6">
          {me?.operator ? (
            <p className="text-sm">
              <Link href="/app/operator" className="underline underline-offset-4">
                Open the operator page
              </Link>
            </p>
          ) : null}
          {totals ? (
            <section
              className="flex flex-col gap-2"
              aria-label={`Across your ${counted.length} kitchens`}
            >
              <h2 className="text-sm font-medium text-muted-foreground">
                Across your {counted.length} kitchens
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {totals.running.kitchens > 0 ? (
                  <>
                    <StatCard label="Owed to your kitchens">
                      <Money paise={totals.running.owed} />
                    </StatCard>
                    <StatCard label="To confirm">{totals.running.toConfirm || "-"}</StatCard>
                  </>
                ) : null}
                {totals.owe.kitchens > 0 ? (
                  <StatCard label="You owe">
                    <Money paise={totals.owe.amount} />
                  </StatCard>
                ) : null}
              </div>
            </section>
          ) : null}
          {list.length === 0 && organisations.length === 0 ? (
            <EmptyState
              title="You are not in a kitchen yet"
              description="Start one, or open the invitation link someone sent you."
              action={mayStart ? newKitchen : undefined}
            />
          ) : null}
          {list.length > 0 ? (
            <ItemGroup className="gap-2">
              {list.map((w) => (
                <Item key={w.slug} variant="outline" role="listitem">
                  <ItemMedia>
                    <Avatar>
                      <AvatarFallback>{initials(w.name)}</AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="flex-wrap">
                      <h3 className="font-medium">{w.name}</h3>
                      {w.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {ROLE[r]}
                        </Badge>
                      ))}
                      {w.state === "MOVED" ? <Badge variant="outline">Moved</Badge> : null}
                      {w.state === "MIGRATING" ? <Badge variant="outline">Moving</Badge> : null}
                    </ItemTitle>
                    {several && w.state === "ACTIVE" ? (
                      <ItemDescription className="line-clamp-none">
                        <Figures f={figures[w.slug]} />
                      </ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    {w.state === "MOVED" && w.movedTo ? (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        aria-label={`Open ${w.name} at its new address`}
                        render={<a href={w.movedTo} />}
                      >
                        Open at its new address
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        aria-label={`Open ${w.name}`}
                        render={<Link href={`/w/${w.slug}`} />}
                      >
                        Open
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : null}
          {organisations.length > 0 ? (
            <section className="flex flex-col gap-2" aria-labelledby="head-office-h">
              <h2 id="head-office-h" className="text-base font-semibold">
                Head office
              </h2>
              <ItemGroup className="gap-2">
                {organisations.map((o) => (
                  <Item key={o.id} variant="outline" role="listitem">
                    <ItemMedia variant="icon">
                      <LandmarkIcon aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <h3 className="font-medium">{o.name}</h3>
                      </ItemTitle>
                      <ItemDescription>
                        {o.kitchens === 0
                          ? "No kitchen shares its totals yet"
                          : `${o.kitchens} kitchen${o.kitchens === 1 ? "" : "s"} share their totals`}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        aria-label={`Open ${o.name}`}
                        render={<Link href={`/app/org/${o.id}`} />}
                      >
                        Open
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          ) : null}
        </div>
      </SignedIn>
    </OutsideLayout>
  );
}
