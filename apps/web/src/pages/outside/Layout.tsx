import { CircleHelpIcon, LogOutIcon, ServerCogIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { PageSkeleton } from "@/components/app";
import { Mark } from "@/components/Mark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSession } from "../../session.tsx";
import { initials, THEME_NAME } from "../../shell/account.tsx";
import { SkipLink } from "../../shell/SkipLink.tsx";
import { THEMES, type Theme, useTheme } from "../../theme.ts";

/** Who is signed in, as a round button that opens their menu: theme, help, the operator's page, sign out. */
function AccountMenu() {
  const { me, signOut } = useSession();
  const [, go] = useLocation();
  const [theme, setTheme] = useTheme();
  if (!me?.account) return null;
  const name = me.account.name ?? me.account.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Account: ${name}`} />}
      >
        <Avatar size="sm">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col py-1.5">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <span className="truncate">{me.account.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(t) => setTheme(t as Theme)}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t} value={t}>
                {THEME_NAME[t]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {me.operator ? (
          <DropdownMenuItem onClick={() => go("/app/operator")}>
            <ServerCogIcon />
            Operator
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<a href="/guides/" target="_blank" rel="noopener" />}>
          <CircleHelpIcon />
          Help and guides ↗
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut().then(() => go("/"))}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The frame of every page outside a kitchen (sign in, join, your kitchens, a new kitchen, the operator, a head
 * office): the brand, help and the account in a bar, then the page in `<main id="main">`, where the route
 * effects find the H1 and the skip link lands.
 */
export function OutsideLayout({
  children,
  width = "max-w-5xl",
  centred = false,
}: {
  children: ReactNode;
  /** A Tailwind max-width for the page column. */
  width?: string;
  /** Centre the page in the screen (sign in, join). */
  centred?: boolean;
}) {
  const { me } = useSession();
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <SkipLink />
      <header className="border-b bg-background print:hidden">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <Link
            href={me?.account ? "/app" : "/"}
            className="flex items-center gap-2 rounded-md font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Mark />
            <span className="text-foreground">Alimentation</span>
          </Link>
          <div className="grow" />
          {me?.account ? null : (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<a href="/guides/" target="_blank" rel="noopener" />}
            >
              Help
            </Button>
          )}
          <AccountMenu />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "mx-auto w-full flex-1 px-4 py-6 outline-none md:py-8",
          centred && "flex flex-col items-center justify-center",
          width,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/** For a page that needs someone signed in: shows a skeleton until we know, and sends anyone else to sign in. */
export function SignedIn({
  children,
  skeleton = "list",
}: {
  children: ReactNode;
  skeleton?: "list" | "form" | "table" | "stats";
}) {
  const { me } = useSession();
  const [location, go] = useLocation();
  const signedOut = me !== undefined && !me?.account;
  useEffect(() => {
    if (signedOut)
      go(`/signin?next=${encodeURIComponent(location + window.location.search)}`, {
        replace: true,
      });
  }, [signedOut, location, go]);
  if (me === undefined)
    return (
      <PageSkeleton loading variant={skeleton}>
        {null}
      </PageSkeleton>
    );
  if (signedOut) return null;
  return <>{children}</>;
}
