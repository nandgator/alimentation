import type { BootstrapDto, Role } from "@alimentation/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation, useParams, useSearch } from "wouter";
import { api, setActingAs } from "../api.ts";
import { useLoad } from "../components/ui.tsx";
import { useMedia } from "../home/motion.tsx";
import { KitchenTitle } from "../hooks/use-page-title.ts";
import { type Workspace, WorkspaceProvider } from "../pages/workspace/context.tsx";
import { homeOf, ROLE_LABEL } from "../pages/workspace/sections.ts";
import { DesktopShell } from "./DesktopShell.tsx";
import { PhoneShell } from "./PhoneShell.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { RequireSignIn } from "./RequireSignIn.tsx";
import { documentTitle, RouteEffects } from "./RouteEffects.tsx";
import { WorkspaceRoutes } from "./Routes.tsx";
import { ShellSkeleton } from "./ShellSkeleton.tsx";
import { Unavailable } from "./Unavailable.tsx";
import { useShellNav } from "./useShellNav.ts";
import "./shell.css";

const WIDE = "(min-width: 1024px)";
const ROLES: readonly Role[] = ["admin", "supplier", "consumer"];
const roleKey = (slug: string) => `role:${slug}`;
const asRole = (v: string | null | undefined): Role | null => ROLES.find((r) => r === v) ?? null;

/** The role last acted as: `?as=` in the address first, then what this device remembers. */
function startRole(slug: string, search: string): Role | null {
  const fromUrl = asRole(new URLSearchParams(search).get("as"));
  if (fromUrl) return fromUrl;
  try {
    return asRole(localStorage.getItem(roleKey(slug)));
  } catch {
    return null;
  }
}

function Frame() {
  const wide = useMedia(WIDE);
  const s = useShellNav();
  const title = s.pageTitle
    ? documentTitle(
        s.record ? `${s.record} · ${s.at?.section.label}` : s.pageTitle,
        s.ws.boot.workspace.name,
      )
    : documentTitle("Not found", s.ws.boot.workspace.name);
  const Shell = wide ? DesktopShell : PhoneShell;
  return (
    <KitchenTitle.Provider value={s.ws.boot.workspace.name}>
      <RouteEffects title={title} />
      <ProgressBar active={s.ws.refreshing} />
      <Shell>
        <WorkspaceRoutes />
      </Shell>
    </KitchenTitle.Provider>
  );
}

function Loaded({
  slug,
  boot,
  fromDevice,
  refreshing,
  reload,
  setAs,
}: {
  slug: string;
  boot: BootstrapDto;
  fromDevice: boolean;
  refreshing: boolean;
  reload: () => void;
  setAs: (r: Role) => void;
}) {
  const [, go] = useLocation();
  const base = `/w/${slug}`;
  const people = useMemo(() => new Map(boot.people.map((p) => [p.id, p.name])), [boot.people]);
  const switchRole = useCallback(
    (role: Role) => {
      setAs(role);
      try {
        localStorage.setItem(roleKey(slug), role);
      } catch {
        // The choice then lasts only until the page is closed.
      }
      go(`${homeOf(base, role)}?as=${role}`);
      toast(`Now viewing as ${ROLE_LABEL[role]}`);
    },
    [base, go, setAs, slug],
  );
  const ws: Workspace = {
    slug,
    base,
    boot,
    role: boot.me.role,
    writable: boot.workspace.state === "ACTIVE",
    money: boot.workspace.moneyEnabled,
    fromDevice,
    api: `/api/w/${slug}`,
    refreshing,
    reload,
    switchRole,
    nameOf: (id) => people.get(id) ?? "Someone",
  };
  return (
    <WorkspaceProvider value={ws}>
      <Frame />
    </WorkspaceProvider>
  );
}

function Kitchen({ slug }: { slug: string }) {
  const search = useSearch();
  const [as, setAs] = useState<Role | null>(() => startRole(slug, search));
  useEffect(() => () => setActingAs(null), []);
  const res = useLoad(async () => {
    setActingAs(as);
    const r = await api.get<BootstrapDto>(`/api/w/${slug}/bootstrap`);
    return { ...r, as };
  }, [slug, as]);
  const reload = res.reload;

  if (res.error && !res.data) {
    const status = res.error.status;
    return (
      <Unavailable
        title={status === 403 ? "You're not in this kitchen" : "Page not found"}
        reason={
          status === 404
            ? "There is no kitchen at this address, or you are not in it."
            : status === 410
              ? "This kitchen has been deleted."
              : status === 403
                ? "You are not a member of this kitchen."
                : res.error.message
        }
        showKitchens
        home="/app"
        homeLabel="Your kitchens"
      />
    );
  }
  // A changed role waits for its own statement: the old role's must not be shown as the new one's.
  if (!res.data || res.data.as !== as) return <ShellSkeleton />;
  return (
    <Loaded
      slug={slug}
      boot={res.data.data}
      fromDevice={res.data.fromDevice}
      refreshing={res.loading}
      reload={reload}
      setAs={setAs}
    />
  );
}

/** `/w/:slug/*`: a kitchen, for someone signed in. */
export function WorkspaceShell() {
  const { slug = "" } = useParams();
  return (
    <RequireSignIn>
      <Kitchen key={slug} slug={slug} />
    </RequireSignIn>
  );
}
