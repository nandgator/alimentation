import { Link } from "wouter";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hrefOf } from "../pages/workspace/sections.ts";
import { NavUser } from "./account.tsx";
import { CommandButton, CommandMenu, useCommandMenu } from "./CommandMenu.tsx";
import { KitchenSwitcher } from "./kitchens.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { type Badge, useShellNav } from "./useShellNav.ts";

/** The count beside an entry; it goes when the menu is folded to icons. */
export function CountBadge({ badge }: { badge: Badge }) {
  return (
    <span className="ml-auto min-w-5 rounded-md bg-primary px-1.5 text-center text-xs font-medium text-primary-foreground tabular-nums group-data-[collapsible=icon]:hidden">
      {badge.text}
      {badge.sr ? <span className="sr-only"> {badge.sr}</span> : null}
    </span>
  );
}

const SIDEBAR_COOKIE = "sidebar_state";

/** Whether the menu was left open: kept by the sidebar in a cookie, read once on the way in. */
function wasOpen(): boolean {
  try {
    return !document.cookie.split("; ").includes(`${SIDEBAR_COOKIE}=false`);
  } catch {
    return true;
  }
}

function Trigger() {
  const { state } = useSidebar();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            aria-label={state === "expanded" ? "Collapse menu" : "Expand menu"}
            className="-ml-1"
          />
        }
      />
      <TooltipContent side="bottom">
        {state === "expanded" ? "Collapse menu" : "Expand menu"} <Kbd>⌘B</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function Crumbs() {
  const s = useShellNav();
  const { ws, at } = s;
  const section = at?.section;
  const home = section?.key === "home";
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="min-w-0">
          {home ? (
            <BreadcrumbPage className="truncate">{ws.boot.workspace.name}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink className="truncate" render={<Link href={ws.base} />}>
              {ws.boot.workspace.name}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {section && !home ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {s.record || at?.tab ? (
                <BreadcrumbLink render={<Link href={hrefOf(ws.base, section)} />}>
                  {s.label(section)}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{s.label(section)}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        ) : null}
        {at?.tab || s.record ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{at?.tab?.label ?? s.record}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** The shell from 1024px up: the sidebar of sidebar-07, which folds to a rail of icons, and a bar over the page. */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  const s = useShellNav();
  const menu = useCommandMenu();
  return (
    <SidebarProvider defaultOpen={wasOpen()}>
      <SkipLink />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <KitchenSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Sections">
                <SidebarMenu>
                  {s.nav.side.map((sec) => {
                    const badge = s.badge(sec);
                    const here = s.isActive(sec);
                    return (
                      <SidebarMenuItem key={sec.key}>
                        <SidebarMenuButton
                          tooltip={s.label(sec)}
                          isActive={here}
                          className="h-11 pointer-fine:h-9"
                          render={
                            <Link href={s.href(sec)} aria-current={here ? "page" : undefined} />
                          }
                        >
                          <sec.icon />
                          <span>{s.label(sec)}</span>
                          {badge ? <CountBadge badge={badge} /> : null}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <NavUser />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <Trigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <Crumbs />
          <div className="ml-auto">
            <CommandButton onClick={menu.toggle} />
          </div>
        </header>
        <StatusBar />
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 p-6 outline-none [view-transition-name:page]"
        >
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <CommandMenu open={menu.open} onOpenChange={menu.setOpen} />
    </SidebarProvider>
  );
}
