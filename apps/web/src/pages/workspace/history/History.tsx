import type { HistoryEventDto } from "@alimentation/core";
import {
  BookOpenIcon,
  IndianRupeeIcon,
  InfoIcon,
  type LucideIcon,
  ReceiptTextIcon,
  UsersIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { getJson } from "@/api";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUrlState } from "@/hooks";
import { useWorkspace } from "../context.tsx";
import { fullDay, relativeDay } from "../today/days.ts";
import { LoadError } from "../today/LoadError.tsx";
import { useFetch } from "../today/useFetch.ts";
import { FILTER_KIND, type Filter, groupByDay, type Kind, kindOf, pieces, timeOf } from "./feed.ts";

interface Page {
  events: HistoryEventDto[];
  next: number | null;
}

const PAGE = 50;
const KIND: Record<Kind, { icon: LucideIcon; word: string }> = {
  bill: { icon: ReceiptTextIcon, word: "Bill" },
  payment: { icon: IndianRupeeIcon, word: "Payment" },
  meal: { icon: UtensilsCrossedIcon, word: "Meal" },
  menu: { icon: BookOpenIcon, word: "Kitchen" },
  people: { icon: UsersIcon, word: "People" },
  other: { icon: InfoIcon, word: "Record" },
};

/**
 * What has been done to the reader's own records, in words, newest first, a day at a time (DAT-11). It is the other
 * half of "everything is attributed": the person a change affects can see who made it, and when. Each row has an
 * icon for what it is about and its amounts and dates in bold; chips filter by kind, and the next page is fetched
 * ahead, so the button can say how many more it will show.
 */
export function History() {
  const ws = useWorkspace();
  const tz = ws.boot.workspace.timeZone;
  const [filterParam, setFilter] = useUrlState("type", "all");
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    ...(ws.money
      ? ([
          { value: "bills", label: "Bills" },
          { value: "payments", label: "Payments" },
        ] as const)
      : []),
    { value: "meals", label: "Meals" },
  ];
  const filter = (filters.find((f) => f.value === filterParam)?.value ?? "all") as Filter;

  const first = useFetch("history", () => getJson<Page>(`${ws.api}/history?limit=${PAGE}`));
  const [more, setMore] = useState<Page | null>(null);
  const [ahead, setAhead] = useState<{ from: number; page: Page } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Error | null>(null);

  const events = [...(first.data?.events ?? []), ...(more?.events ?? [])];
  const cursor = more ? more.next : (first.data?.next ?? null);
  const fetched = useRef<number | null>(null);

  // The page after the one on screen, fetched quietly, so "Show older" is instant and can say how many it adds.
  useEffect(() => {
    if (cursor === null || fetched.current === cursor) return;
    fetched.current = cursor;
    let live = true;
    getJson<Page>(`${ws.api}/history?limit=${PAGE}&before=${cursor}`).then(
      (page) => live && setAhead({ from: cursor, page }),
      () => {
        fetched.current = null;
      },
    );
    return () => {
      live = false;
    };
  }, [cursor, ws.api]);

  const showOlder = async () => {
    if (cursor === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const page =
        ahead?.from === cursor
          ? ahead.page
          : await getJson<Page>(`${ws.api}/history?limit=${PAGE}&before=${cursor}`);
      setMore((m) => ({ events: [...(m?.events ?? []), ...page.events], next: page.next }));
    } catch (e) {
      setProblem(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const kept =
    filter === "all" ? events : events.filter((e) => kindOf(e.text) === FILTER_KIND[filter]);
  const days = groupByDay(kept, tz);
  const coming = ahead?.from === cursor ? ahead.page.events.length : null;
  const olderLabel = coming ? `Show older (${coming} more)` : "Show older";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="History"
        description={
          ws.role === "consumer"
            ? "Everything done to your meals, payments and bills, and by whom. It cannot be changed or removed."
            : "Everything done to the meals, payments and bills you can see, and by whom. It cannot be changed or removed."
        }
      />

      {first.error ? (
        <div className="mb-4">
          <LoadError error={first.error} what="the history" onRetry={first.reload} />
        </div>
      ) : null}

      <PageSkeleton loading={!first.data && !first.error} variant="list">
        {first.data ? (
          <>
            {events.length > 0 ? (
              <ToggleGroup
                variant="outline"
                aria-label="Show"
                className="mb-4 flex-wrap"
                value={[filter]}
                onValueChange={(v: string[]) => v[0] && setFilter(v[0])}
              >
                {filters.map((f) => (
                  <ToggleGroupItem key={f.value} value={f.value}>
                    {f.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}

            {events.length === 0 ? (
              <EmptyState
                title="Nothing has happened yet"
                description="Entries, payments and bills will be listed here as they are made."
              />
            ) : days.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing of this kind among what is shown
                {cursor !== null ? ". Older entries may have some." : "."}
              </p>
            ) : (
              days.map((d) => (
                <section key={d.day} aria-labelledby={`h-${d.day}`} className="mb-4">
                  <h2
                    id={`h-${d.day}`}
                    className="sticky top-14 z-10 flex items-baseline gap-2 bg-background py-2 text-sm font-semibold"
                  >
                    {relativeDay(d.day, ws.boot.today)}
                    <span className="font-normal text-muted-foreground">{fullDay(d.day)}</span>
                  </h2>
                  <ol className="divide-y rounded-xl border bg-card">
                    {d.events.map((e) => {
                      const k = KIND[kindOf(e.text)];
                      const Icon = k.icon;
                      return (
                        <li key={e.id} className="flex items-start gap-3 p-3">
                          <Icon
                            aria-hidden="true"
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                          />
                          <p className="min-w-0 flex-1 text-sm">
                            <span className="sr-only">{k.word}: </span>
                            {pieces(e.text).map((p, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one sentence never reorder
                              <Fragment key={i}>
                                {p.bold ? (
                                  <strong className="font-semibold">{p.text}</strong>
                                ) : (
                                  p.text
                                )}
                              </Fragment>
                            ))}
                          </p>
                          <time
                            dateTime={e.at}
                            className="shrink-0 text-sm tabular-nums text-muted-foreground"
                          >
                            {timeOf(e.at, tz)}
                          </time>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))
            )}

            {problem ? (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {problem.message}
              </p>
            ) : null}
            {cursor !== null && !(coming === 0 && ahead?.page.next === null) ? (
              <div>
                <Button
                  variant="outline"
                  disabled={busy}
                  loading={busy}
                  loadingText="Loading…"
                  onClick={() => void showOlder()}
                >
                  {olderLabel}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </PageSkeleton>
    </div>
  );
}
