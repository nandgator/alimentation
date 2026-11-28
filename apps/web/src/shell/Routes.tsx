import { Redirect, Route, Switch, useLocation, useParams } from "wouter";
import { InsideHub } from "@/components/app";
import { useWorkspace } from "../pages/workspace/context.tsx";
import {
  denial,
  type HubKey,
  homeOf,
  hrefOf,
  sectionsFor,
  tabsFor,
} from "../pages/workspace/sections.ts";
import { HubHeader } from "./HubTabs.tsx";
import { Unavailable } from "./Unavailable.tsx";
import { DETAIL, TAB_VIEW, VIEW } from "./views.tsx";

/** The answer to an address with no screen for this person here. */
export function NothingHere() {
  const ws = useWorkspace();
  const [location] = useLocation();
  const admin = ws.boot.people.find((p) => p.role === "admin")?.name;
  const d = denial(ws.base, location, ws.role, admin);
  return <Unavailable {...d} home={homeOf(ws.base, ws.role)} />;
}

function HubPage({ hub }: { hub: HubKey }) {
  const ws = useWorkspace();
  const { tab: key = "" } = useParams();
  const tabs = tabsFor(hub, ws.money, Boolean(ws.boot.rateCard));
  const tab = tabs.find((t) => t.path === `/${key}`);
  const View = tab ? TAB_VIEW[tab.key] : undefined;
  if (!tab || !View) return <NothingHere />;
  return (
    <div className="flex flex-col">
      <HubHeader
        base={ws.base}
        hub={hub}
        active={tab}
        money={ws.money}
        priced={Boolean(ws.boot.rateCard)}
      />
      <InsideHub.Provider value={true}>
        <View />
      </InsideHub.Provider>
    </div>
  );
}

/** Every address of a kitchen, read from the list of screens the role has: the rest are "not here". */
export function WorkspaceRoutes() {
  const ws = useWorkspace();
  const { base, role } = ws;
  const mine = sectionsFor(role, ws.money, Boolean(ws.boot.rateCard));
  return (
    <Switch>
      <Route path={base}>
        {role === "supplier" ? <Redirect to={homeOf(base, role)} replace /> : <VIEW.home />}
      </Route>
      {mine.map((s) => {
        if (s.key === "home") return null;
        const href = hrefOf(base, s);
        if (s.key === "setup" || s.key === "books") {
          const hub = s.key;
          const first = tabsFor(hub, ws.money, Boolean(ws.boot.rateCard))[0];
          return [
            <Route key={`${s.key}-root`} path={href}>
              {first ? <Redirect to={`${href}${first.path}`} replace /> : <NothingHere />}
            </Route>,
            <Route key={s.key} path={`${href}/:tab/*?`}>
              <HubPage hub={hub} />
            </Route>,
          ];
        }
        const View = VIEW[s.key];
        const Detail = DETAIL[s.key];
        return [
          <Route key={s.key} path={href}>
            <View />
          </Route>,
          Detail ? (
            <Route key={`${s.key}-one`} path={`${href}/:id`}>
              <Detail />
            </Route>
          ) : null,
        ];
      })}
      <Route>
        <NothingHere />
      </Route>
    </Switch>
  );
}
