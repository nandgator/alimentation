import type { Role } from "@alimentation/core";
import {
  ChevronsUpDownIcon,
  CircleHelpIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useLocation } from "wouter";
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
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useWorkspace } from "../pages/workspace/context.tsx";
import { ROLE_LABEL } from "../pages/workspace/sections.ts";
import { useSession } from "../session.tsx";
import { THEMES, type Theme, useTheme } from "../theme.ts";

export const THEME_NAME: Record<Theme, string> = { auto: "System", light: "Light", dark: "Dark" };
const THEME_ICON = { auto: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Two letters for a round badge: the first of two names, or the first two of one. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`
      : (parts[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase() || "?";
}

/** Who is signed in, which roles they hold here, and what signing out does. */
export function useAccount() {
  const { me, signOut } = useSession();
  const ws = useWorkspace();
  const [, go] = useLocation();
  const name = me?.account?.name ?? me?.account?.email ?? "Account";
  return {
    name,
    email: me?.account?.email ?? "",
    roles: ws.boot.roles,
    role: ws.role,
    timeZone: ws.boot.workspace.timeZone,
    switchRole: ws.switchRole,
    signOut: () => void signOut().then(() => go("/")),
  };
}

/** The footer of the sidebar: the account, and everything about "me" in one menu. */
export function NavUser() {
  const a = useAccount();
  const [theme, setTheme] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            tooltip="Account"
            className="data-popup-open:bg-sidebar-accent"
          />
        }
      >
        <Avatar size="sm" className="rounded-lg">
          <AvatarFallback className="rounded-lg">{initials(a.name)}</AvatarFallback>
        </Avatar>
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{a.name}</span>
          <span className="truncate text-xs text-muted-foreground">{ROLE_LABEL[a.role]}</span>
        </span>
        <ChevronsUpDownIcon className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col py-1.5">
            <span className="truncate text-sm font-medium text-foreground">{a.name}</span>
            <span className="truncate">{a.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {a.roles.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>View as</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={a.role}
                onValueChange={(r) => {
                  if (r !== a.role) a.switchRole(r as Role);
                }}
              >
                {a.roles.map((r) => (
                  <DropdownMenuRadioItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        ) : null}
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
        <DropdownMenuItem render={<a href="/guides/" target="_blank" rel="noopener" />}>
          <CircleHelpIcon />
          Help and guides ↗
        </DropdownMenuItem>
        <DropdownMenuItem onClick={a.signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">Times in {a.timeZone}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same account menu as the body of a bottom sheet, for a phone. */
export function AccountPanel({ onDone }: { onDone: () => void }) {
  const a = useAccount();
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex items-center gap-3">
        <Avatar size="lg">
          <AvatarFallback>{initials(a.name)}</AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 text-sm leading-tight">
          <span className="truncate font-medium">{a.name}</span>
          <span className="truncate text-muted-foreground">{a.email}</span>
        </div>
      </div>
      {a.roles.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">View as</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="View as">
            {a.roles.map((r) => (
              <Button
                key={r}
                type="button"
                role="radio"
                aria-checked={r === a.role}
                variant={r === a.role ? "default" : "outline"}
                onClick={() => {
                  if (r !== a.role) a.switchRole(r);
                  onDone();
                }}
              >
                {ROLE_LABEL[r]}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Theme</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => {
            const Icon = THEME_ICON[t];
            return (
              <Button
                key={t}
                type="button"
                role="radio"
                aria-checked={t === theme}
                variant={t === theme ? "default" : "outline"}
                onClick={() => setTheme(t)}
              >
                <Icon />
                {THEME_NAME[t]}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="/guides/" target="_blank" rel="noopener" />}
        >
          <CircleHelpIcon />
          Help and guides ↗
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onDone();
            a.signOut();
          }}
        >
          <LogOutIcon />
          Sign out
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Times in {a.timeZone}</p>
    </div>
  );
}
