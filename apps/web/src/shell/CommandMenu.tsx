import { BookOpenIcon, CornerDownLeftIcon, PlusIcon, SearchIcon, UserIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { hrefOf, tabsFor } from "../pages/workspace/sections.ts";
import { useShellNav } from "./useShellNav.ts";

interface Action {
  label: string;
  to: string;
  words?: string;
}

/**
 * The search over the kitchen (Ctrl/Cmd+K, or "/" when no field has focus): where to go, who (for the
 * admin), and the few things to do. An action opens its screen with `?action=` set, which the screen may
 * answer by opening its form: log, record, add, prices.
 */
export function useCommandMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = (e.target as HTMLElement | null)?.closest?.(
        "input, textarea, select, [contenteditable=true], [role=textbox]",
      );
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !field && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen, toggle: useCallback(() => setOpen((o) => !o), []) };
}

/** The button in the page header that opens it. */
export function CommandButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 text-muted-foreground"
      onClick={onClick}
      aria-keyshortcuts="Control+K Meta+K"
    >
      <SearchIcon />
      Search
      <Kbd>⌘K</Kbd>
    </Button>
  );
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const s = useShellNav();
  const [, go] = useLocation();
  const { ws } = s;
  const people = ws.role === "admin" ? ws.boot.people.filter((p) => p.status === "ACTIVE") : [];

  const actions = useMemo<Action[]>(() => {
    const has = (key: string) => s.nav.side.some((x) => x.key === key);
    const to = (key: string, action: string) => {
      const sec = s.nav.side.find((x) => x.key === key);
      return sec ? `${hrefOf(ws.base, sec)}?action=${action}` : null;
    };
    const out: Action[] = [];
    const log = has("today") ? to("today", "log") : to("meals", "log");
    if (log) out.push({ label: "Log a meal", to: log, words: "add entry eat extra skip" });
    const pay = to("payments", "record");
    if (pay)
      out.push({
        label: ws.role === "consumer" ? "I paid" : "Record a payment",
        to: pay,
        words: "pay money claim",
      });
    if (ws.role === "admin") {
      const add = to("people", "add");
      if (add) out.push({ label: "Add a person", to: add, words: "consumer cook invite" });
      if (ws.money && s.priced)
        out.push({
          label: "New prices",
          to: `${ws.base}/setup/prices?action=new`,
          words: "rate card",
        });
    }
    return out;
  }, [s.nav.side, s.priced, ws.base, ws.money, ws.role]);

  const run = (to: string) => {
    onOpenChange(false);
    go(to);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search this kitchen"
      description="Go to a screen, find a person, or start something."
    >
      <CommandInput placeholder="Go to, find, or do…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {s.nav.side.map((sec) => (
            <CommandItem
              key={sec.key}
              value={`go ${s.label(sec)}`}
              onSelect={() => run(s.href(sec))}
            >
              <sec.icon />
              {s.label(sec)}
            </CommandItem>
          ))}
          {ws.role === "admin"
            ? (["setup", "books"] as const).flatMap((hub) =>
                tabsFor(hub, ws.money, s.priced).map((t) => (
                  <CommandItem
                    key={`${hub}${t.path}`}
                    value={`go ${hub} ${t.label}`}
                    onSelect={() => run(`${ws.base}/${hub}${t.path}`)}
                  >
                    <BookOpenIcon />
                    {hub === "setup" ? "Setup" : "Books"} › {t.label}
                  </CommandItem>
                )),
              )
            : null}
        </CommandGroup>
        {people.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="People">
              {people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`person ${p.name} ${p.id}`}
                  onSelect={() => run(`${ws.base}/people/${p.id}`)}
                >
                  <UserIcon />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {actions.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem
                  key={a.label}
                  value={`do ${a.label} ${a.words ?? ""}`}
                  onSelect={() => run(a.to)}
                >
                  <PlusIcon />
                  {a.label}
                  <CornerDownLeftIcon className="ml-auto opacity-40" />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
