import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon, ShieldIcon } from "lucide-react";
import { Link } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Mark } from "../components/Mark.tsx";
import { useWorkspace } from "../pages/workspace/context.tsx";
import { ROLE_LABEL } from "../pages/workspace/sections.ts";
import { useSession } from "../session.tsx";
import { initials } from "./account.tsx";

/** The kitchens of this person, this one first as it is, and the ways out of the kitchen. */
function useKitchens() {
  const { me } = useSession();
  const ws = useWorkspace();
  const mine = (me?.workspaces ?? []).filter((w) => w.state !== "WIPING");
  const list = mine.some((w) => w.slug === ws.slug)
    ? mine
    : [{ slug: ws.slug, name: ws.boot.workspace.name }, ...mine];
  return { list, current: ws.slug, operator: Boolean(me?.operator) };
}

/** The head of the sidebar: which kitchen this is, and a menu to go to another one (after sidebar-07's team switcher). */
export function KitchenSwitcher() {
  const ws = useWorkspace();
  const k = useKitchens();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            tooltip="Switch kitchen"
            className="data-popup-open:bg-sidebar-accent"
          />
        }
      >
        <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Mark size={20} />
        </span>
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{ws.boot.workspace.name}</span>
          <span className="truncate text-xs text-muted-foreground">{ROLE_LABEL[ws.role]}</span>
        </span>
        <ChevronsUpDownIcon className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Kitchens</DropdownMenuLabel>
          {k.list.map((w) => (
            <DropdownMenuItem
              key={w.slug}
              nativeButton={false}
              render={<Link href={`/w/${w.slug}`} />}
            >
              <span className="truncate">{w.name}</span>
              {w.slug === k.current ? <CheckIcon className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem nativeButton={false} render={<Link href="/app" />}>
          <LayoutGridIcon />
          All kitchens
        </DropdownMenuItem>
        {k.operator ? (
          <DropdownMenuItem nativeButton={false} render={<Link href="/app/operator" />}>
            <ShieldIcon />
            Operator
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same list as the body of a bottom sheet, for a phone. */
export function KitchenPanel({ onDone }: { onDone: () => void }) {
  const k = useKitchens();
  return (
    <nav aria-label="Kitchens" className="flex flex-col gap-1 px-2 pb-6">
      {k.list.map((w) => (
        <Button
          key={w.slug}
          variant="ghost"
          className="h-12 justify-start gap-3 px-3"
          aria-current={w.slug === k.current ? "true" : undefined}
          nativeButton={false}
          render={<Link href={`/w/${w.slug}`} replace onClick={onDone} />}
        >
          <Avatar size="sm" className="rounded-lg">
            <AvatarFallback className="rounded-lg">{initials(w.name)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{w.name}</span>
          {w.slug === k.current ? <CheckIcon className="ml-auto" /> : null}
        </Button>
      ))}
      <Button
        variant="ghost"
        className="h-12 justify-start gap-3 px-3"
        nativeButton={false}
        render={<Link href="/app" replace onClick={onDone} />}
      >
        <LayoutGridIcon />
        All kitchens
      </Button>
      {k.operator ? (
        <Button
          variant="ghost"
          className="h-12 justify-start gap-3 px-3"
          nativeButton={false}
          render={<Link href="/app/operator" replace onClick={onDone} />}
        >
          <ShieldIcon />
          Operator
        </Button>
      ) : null}
    </nav>
  );
}
