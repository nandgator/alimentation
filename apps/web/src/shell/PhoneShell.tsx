import { ArrowLeftIcon, EllipsisIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { hrefOf } from "../pages/workspace/sections.ts";
import { AccountPanel, initials, useAccount } from "./account.tsx";
import { KitchenPanel } from "./kitchens.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { useBackClosesSheet } from "./useBackClosesSheet.ts";
import { useShellNav } from "./useShellNav.ts";

/** A bottom sheet of the shell: a handle, a title, a close button, and Back closes it. */
function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  useBackClosesSheet(open, () => onOpenChange(false));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="shell-sheet gap-2 rounded-t-xl">
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted-foreground/30"
        />
        <SheetHeader className="pt-1 pr-14">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

const tab =
  "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5";

/** The shell below 1024px: a top bar with the page's title, a bar of icons at the bottom, and More as a sheet. */
export function PhoneShell({ children }: { children: ReactNode }) {
  const s = useShellNav();
  const a = useAccount();
  const [more, setMore] = useState(false);
  const [kitchens, setKitchens] = useState(false);
  const [account, setAccount] = useState(false);
  const { ws, at } = s;
  // Choosing a screen closes whatever sheet was open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the address changes
  useEffect(() => {
    setMore(false);
    setKitchens(false);
    setAccount(false);
  }, [s.location]);
  const moreHere = s.nav.more.some((m) => s.isActive(m));
  const section = at?.section;
  const sections = s.nav.bar;

  return (
    <div className="phone-shell flex min-h-svh flex-col bg-background">
      <SkipLink />
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2">
        {s.detail && section ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Back to ${s.label(section)}`}
            nativeButton={false}
            render={<Link href={hrefOf(ws.base, section)} />}
          >
            <ArrowLeftIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={`${ws.boot.workspace.name}, change kitchen`}
            onClick={() => setKitchens(true)}
          >
            <Avatar size="sm" className="rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                {initials(ws.boot.workspace.name)}
              </AvatarFallback>
            </Avatar>
          </Button>
        )}
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {s.pageTitle ?? ws.boot.workspace.name}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={`Account, ${a.name}`}
          onClick={() => setAccount(true)}
        >
          <Avatar size="sm">
            <AvatarFallback>{initials(a.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </header>
      <StatusBar />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 pt-4 pb-[calc(var(--bottom-bar)+1rem)] outline-none [view-transition-name:page]"
      >
        {children}
      </main>
      <nav
        aria-label="Sections"
        className="phone-bottom-bar fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-background px-1"
      >
        {sections.map((sec) => {
          const here = s.isActive(sec);
          const badge = s.badge(sec);
          return (
            <Link
              key={sec.key}
              href={s.href(sec)}
              aria-current={here ? "page" : undefined}
              className={cn(
                tab,
                here &&
                  "text-primary before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-highlight",
              )}
            >
              <span className="relative">
                <sec.icon />
                {badge ? (
                  <span className="absolute -top-1.5 left-3 min-w-4 rounded-full bg-primary px-1 text-center text-xs leading-4 text-primary-foreground tabular-nums">
                    {badge.text}
                    {badge.sr ? <span className="sr-only"> {badge.sr}</span> : null}
                  </span>
                ) : null}
              </span>
              {s.label(sec)}
            </Link>
          );
        })}
        {s.nav.more.length > 0 ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={more}
            aria-current={moreHere ? "page" : undefined}
            onClick={() => setMore(true)}
            className={cn(
              tab,
              moreHere &&
                "text-primary before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-highlight",
            )}
          >
            <EllipsisIcon />
            More
          </button>
        ) : null}
      </nav>

      <BottomSheet
        open={more}
        onOpenChange={setMore}
        title="More"
        description="The rest of the screens of this kitchen."
      >
        <nav aria-label="More sections" className="flex flex-col gap-1 px-2 pb-4">
          {s.nav.more.map((sec) => (
            <Link
              key={sec.key}
              href={s.href(sec)}
              replace
              aria-current={s.isActive(sec) ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                s.isActive(sec) ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <sec.icon className="size-5" />
              {s.label(sec)}
            </Link>
          ))}
        </nav>
      </BottomSheet>
      <BottomSheet
        open={kitchens}
        onOpenChange={setKitchens}
        title="Kitchens"
        description="Go to another kitchen, or to all of yours."
      >
        <KitchenPanel onDone={() => setKitchens(false)} />
      </BottomSheet>
      <BottomSheet
        open={account}
        onOpenChange={setAccount}
        title="Account"
        description="Who you are, how you view this kitchen, the theme, and sign out."
      >
        <AccountPanel onDone={() => setAccount(false)} />
      </BottomSheet>
    </div>
  );
}
