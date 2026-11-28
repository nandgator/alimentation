import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { getJson } from "@/api";
import { DateField, EmptyState, PageHeader, PageSkeleton } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsNarrow } from "@/hooks/use-media-query";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../context.tsx";
import {
  ACTIONS,
  type ActionKey,
  type AuditEntry,
  actionKey,
  actionWords,
  changesOf,
  dayOf,
  dayWords,
  entityWords,
  filterEntries,
  groupByDay,
  SYSTEM,
  timeWords,
} from "./auditWords.ts";
import { LoadProblem, useLoad } from "./parts.tsx";

/** How many the page asks the server for at a time: the most it gives. */
const FETCH = 500;
/** How many rows are on a page of the trail. */
const PAGE = 50;

const ACTION_LOOK: Record<ActionKey, { icon: typeof PlusIcon; tone: string }> = {
  added: { icon: PlusIcon, tone: "bg-muted text-foreground" },
  changed: { icon: PencilIcon, tone: "bg-muted text-foreground" },
  removed: { icon: Trash2Icon, tone: "border-destructive/40 bg-background text-destructive" },
};

/** What was done: an icon and a word, never colour alone. */
function ActionBadge({ entry }: { entry: AuditEntry }) {
  const look = ACTION_LOOK[actionKey(entry)];
  const Icon = look.icon;
  return (
    <Badge variant="secondary" className={look.tone}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {actionWords(entry)}
    </Badge>
  );
}

/** One entry in full: who, when, what, and the fields that changed. */
function Detail({
  entry,
  onClose,
  who,
  timeZone,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
  who: (e: AuditEntry) => string;
  timeZone: string;
}) {
  const narrow = useIsNarrow();
  const shown = useMemo(() => (entry ? changesOf(entry) : []), [entry]);
  const when = entry
    ? `${dayWords(dayOf(entry.at, timeZone), dayOf(new Date().toISOString(), timeZone))}, ${timeWords(entry.at, timeZone)}`
    : "";
  return (
    <Sheet open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={narrow ? "bottom" : "right"}
        className="max-h-dvh overflow-y-auto sm:max-w-lg"
      >
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle>
                {actionWords(entry)}: {entityWords(entry.table)}
              </SheetTitle>
              <SheetDescription>
                {who(entry)}
                {entry.via ? " (through an AI agent)" : ""} · {when}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No details were kept for this entry.
                </p>
              ) : (
                <Table aria-label="What changed">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      {entry.action !== "INSERT" ? <TableHead>Before</TableHead> : null}
                      {entry.action !== "DELETE" ? <TableHead>After</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((c) => (
                      <TableRow key={c.field}>
                        <TableCell className="font-medium whitespace-normal">{c.field}</TableCell>
                        {entry.action !== "INSERT" ? (
                          <TableCell className="break-words whitespace-normal text-muted-foreground">
                            {c.before}
                          </TableCell>
                        ) : null}
                        {entry.action !== "DELETE" ? (
                          <TableCell className="break-words whitespace-normal">{c.after}</TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function Audit() {
  const ws = useWorkspace();
  const tz = ws.boot.workspace.timeZone;
  const narrow = useIsNarrow();
  // The filters, and the page, live in the address (NAV-16): a link to a search is a search.
  const [q, setQ] = useUrlState("q");
  const [person, setPerson] = useUrlState("person");
  const [action, setAction] = useUrlState("action");
  const [entity, setEntity] = useUrlState("entity");
  const [from, setFrom] = useUrlState("from");
  const [to, setTo] = useUrlState("to");
  const [pageText, setPage] = useUrlState("page", "1");
  const [open, setOpen] = useState<AuditEntry | null>(null);

  // The newest entries first; "Show older" asks for the ones before the last seen.
  const [before, setBefore] = useState<number | null>(null);
  const [seen, setSeen] = useState<AuditEntry[]>([]);
  const [lastBatch, setLastBatch] = useState(0);
  const res = useLoad(async () => {
    const rows = await getJson<AuditEntry[]>(
      `${ws.api}/audit?limit=${FETCH}${before ? `&before=${before}` : ""}`,
    );
    setSeen((prev) => (before ? [...prev, ...rows] : rows));
    setLastBatch(rows.length);
    return rows;
  }, [ws.api, before]);
  const more = lastBatch === FETCH;

  const who = (e: AuditEntry) => (e.actor ? ws.nameOf(e.actor) : "System");
  const filter = useMemo(
    () => ({ q, person, action: (action || "") as ActionKey | "", entity, from, to }),
    [q, person, action, entity, from, to],
  );
  const matching = useMemo(
    () => filterEntries(seen, filter, ws.nameOf, tz),
    [seen, filter, ws.nameOf, tz],
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const page = Math.min(Math.max(1, Number.parseInt(pageText, 10) || 1), pages);
  const rows = matching.slice((page - 1) * PAGE, page * PAGE);
  const first = matching.length === 0 ? 0 : (page - 1) * PAGE + 1;
  const last = Math.min(matching.length, page * PAGE);
  const today = dayOf(new Date().toISOString(), tz);
  const groups = useMemo(() => groupByDay(rows, tz), [rows, tz]);

  // The choices come from what has been loaded: who acted, and which kinds of record changed.
  const actors = useMemo(
    () => [...new Set(seen.flatMap((e) => (e.actor ? [e.actor] : [])))],
    [seen],
  );
  const hasSystem = seen.some((e) => e.actor === null);
  const entities = useMemo(
    () =>
      [...new Set(seen.map((e) => e.table))].sort((a, b) =>
        entityWords(a).localeCompare(entityWords(b)),
      ),
    [seen],
  );
  const filtered = Boolean(q || person || action || entity || from || to);
  /** A new filter starts on the first page. */
  const set = (apply: (v: string) => void) => (v: string) => {
    apply(v);
    setPage("1");
  };
  const clear = () => {
    for (const s of [setQ, setPerson, setAction, setEntity, setFrom, setTo, setPage]) s("");
  };

  return (
    <>
      <PageHeader
        title="Audit"
        description="Every change, who made it and when. Names and notes appear as “(encrypted)”: the trail itself holds no readable details."
      />
      <LoadProblem error={res.error} onRetry={res.reload} />
      <PageSkeleton loading={res.loading && seen.length === 0 && !res.error} variant="table">
        {seen.length === 0 && !res.loading ? (
          <EmptyState
            title="Nothing has been recorded yet"
            description="Every change made in this kitchen shows here, with who made it."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div role="search" aria-label="Filter the audit trail" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <InputGroup className="w-full sm:max-w-xs">
                  <InputGroupAddon>
                    <SearchIcon aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    aria-label="Search the trail"
                    placeholder="Search the trail…"
                    value={q}
                    onChange={(e) => set(setQ)(e.target.value)}
                  />
                </InputGroup>
                <NativeSelect
                  aria-label="Person"
                  className="w-auto"
                  value={person}
                  onChange={(e) => set(setPerson)(e.target.value)}
                >
                  <NativeSelectOption value="">Everyone</NativeSelectOption>
                  {actors.map((id) => (
                    <NativeSelectOption key={id} value={id}>
                      {ws.nameOf(id)}
                    </NativeSelectOption>
                  ))}
                  {hasSystem ? (
                    <NativeSelectOption value={SYSTEM}>System</NativeSelectOption>
                  ) : null}
                </NativeSelect>
                <NativeSelect
                  aria-label="Action"
                  className="w-auto"
                  value={action}
                  onChange={(e) => set(setAction)(e.target.value)}
                >
                  <NativeSelectOption value="">Any action</NativeSelectOption>
                  {ACTIONS.map((a) => (
                    <NativeSelectOption key={a.key} value={a.key}>
                      {a.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Kind of record"
                  className="w-auto"
                  value={entity}
                  onChange={(e) => set(setEntity)(e.target.value)}
                >
                  <NativeSelectOption value="">Any record</NativeSelectOption>
                  {entities.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {entityWords(t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-40 flex-1 flex-col gap-1.5 sm:max-w-48 sm:flex-none">
                  <Label htmlFor="audit-from">From</Label>
                  <DateField
                    id="audit-from"
                    label="From date"
                    value={from}
                    max={to || undefined}
                    today={today}
                    placeholder="Any day"
                    onChange={set(setFrom)}
                  />
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-1.5 sm:max-w-48 sm:flex-none">
                  <Label htmlFor="audit-to">To</Label>
                  <DateField
                    id="audit-to"
                    label="To date"
                    value={to}
                    min={from || undefined}
                    today={today}
                    placeholder="Any day"
                    onChange={set(setTo)}
                  />
                </div>
                {filtered ? (
                  <Button type="button" variant="ghost" onClick={clear}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>

            {matching.length === 0 ? (
              <EmptyState
                title="Nothing matches"
                description={
                  more
                    ? "Try a different search, or show older entries."
                    : "Try a different search or clear the filters."
                }
                action={
                  filtered ? (
                    <Button type="button" variant="outline" onClick={clear}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : narrow ? (
              <div className="flex flex-col gap-4">
                {groups.map((g) => (
                  <section key={g.day} aria-label={dayWords(g.day, today)}>
                    <h2 className="sticky top-14 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-sm font-semibold">
                      {dayWords(g.day, today)}
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {g.entries.map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setOpen(e)}
                            className="flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-medium">{entityWords(e.table)}</span>
                              <ActionBadge entry={e} />
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {who(e)} · {timeWords(e.at, tz)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border">
                <Table aria-label="Audit trail">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-24">Time</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Record</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <GroupRows key={g.day} day={dayWords(g.day, today)}>
                        {g.entries.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {timeWords(e.at, tz)}
                            </TableCell>
                            <TableCell>{who(e)}</TableCell>
                            <TableCell>
                              <ActionBadge entry={e} />
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => setOpen(e)}
                                className="rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                {entityWords(e.table)}
                                <span className="sr-only">
                                  , {actionWords(e)} at {timeWords(e.at, tz)}: details
                                </span>
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </GroupRows>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <p aria-live="polite" className="tabular-nums">
                {matching.length === 0
                  ? "No entries"
                  : `${first}-${last} of ${matching.length}${more ? "+" : ""}`}
                {more ? " (the newest are loaded)" : ""}
              </p>
              <div className="flex items-center gap-1">
                {more ? (
                  <Button
                    type="button"
                    variant="outline"
                    loading={res.loading}
                    loadingText="Loading…"
                    onClick={() => setBefore(seen.at(-1)?.id ?? null)}
                  >
                    Show older entries
                  </Button>
                ) : null}
                {pages > 1 ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() => setPage(String(page - 1))}
                    >
                      <ChevronLeftIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Next page"
                      disabled={page >= pages}
                      onClick={() => setPage(String(page + 1))}
                    >
                      <ChevronRightIcon aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </PageSkeleton>
      <Detail entry={open} onClose={() => setOpen(null)} who={who} timeZone={tz} />
    </>
  );
}

/** A day's heading as a row that spans the table, and the day's rows under it. */
function GroupRows({ day, children }: { day: string; children: ReactNode }) {
  return (
    <>
      <TableRow className={cn("bg-muted/50 hover:bg-muted/50")}>
        <TableHead colSpan={4} scope="colgroup" className="h-9 font-semibold text-foreground">
          {day}
        </TableHead>
      </TableRow>
      {children}
    </>
  );
}
