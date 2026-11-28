import { lazy, Suspense } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Home } from "./pages/Home.tsx";
import { Join } from "./pages/Join.tsx";
import { NewKitchen } from "./pages/NewKitchen.tsx";
import { Operator } from "./pages/Operator.tsx";
import { Places } from "./pages/Places.tsx";
import { ReceiptPage } from "./pages/Receipt.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { SessionProvider } from "./session.tsx";
import { PendingBar } from "./shell/ProgressBar.tsx";
import { documentTitle, RouteEffects } from "./shell/RouteEffects.tsx";
import { Unavailable } from "./shell/Unavailable.tsx";
import { aroundNav } from "./shell/useTransitionNav.ts";
import { WorkspaceShell } from "./shell/WorkspaceShell.tsx";

// Only a head office opens this one, so nobody else downloads it.
/** The kit page: development, or a build made with VITE_KIT=1 (the e2e build). */
const KIT = import.meta.env.DEV || import.meta.env.VITE_KIT === "1";
const KitPage = lazy(() =>
  import("@/components/app/dev/KitPage").then((m) => ({ default: m.KitPage })),
);
const Organisation = lazy(() =>
  import("./pages/Organisation.tsx").then((m) => ({ default: m.Organisation })),
);

function OrganisationRoute() {
  return (
    <Suspense fallback={<PendingBar />}>
      <Organisation />
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="p-6">
      <Unavailable
        title="Page not found"
        reason="That address does not lead anywhere."
        home="/"
        homeLabel="Go home"
      />
    </div>
  );
}

/** The titles of the pages outside a kitchen. The home page keeps its own. */
function outsideTitle(location: string): string | null {
  if (location === "/" || location.startsWith("/w/")) return null;
  if (location === "/signin") return documentTitle("Sign in");
  if (location === "/app") return documentTitle("Your kitchens");
  if (location === "/app/new") return documentTitle("New kitchen");
  if (location === "/app/operator") return documentTitle("Operator");
  if (location.startsWith("/app/org/")) return documentTitle("Organisation");
  if (location === "/join" || location.startsWith("/join/")) return documentTitle("Join a kitchen");
  if (location.startsWith("/r/")) return documentTitle("Receipt");
  return documentTitle("Page not found");
}

/** Route effects for everything outside a kitchen (the kitchen's own shell runs them for itself). */
function OutsideEffects() {
  const [location] = useLocation();
  if (location.startsWith("/w/")) return null;
  return <RouteEffects title={outsideTitle(location)} />;
}

export function App() {
  return (
    <SessionProvider>
      <TooltipProvider delay={300}>
        <Router aroundNav={aroundNav}>
          <OutsideEffects />
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/signin" component={SignIn} />
            <Route path="/app" component={Places} />
            <Route path="/app/new" component={NewKitchen} />
            <Route path="/app/operator" component={Operator} />
            <Route path="/app/org/:id" component={OrganisationRoute} />
            {KIT && (
              <Route path="/dev/kit">
                <Suspense fallback={<PendingBar />}>
                  <KitPage />
                </Suspense>
              </Route>
            )}
            <Route path="/join/:token?" component={Join} />
            <Route path="/r/:id" component={ReceiptPage} />
            <Route path="/w/:slug/*?" component={WorkspaceShell} />
            <Route component={NotFound} />
          </Switch>
        </Router>
        <Sonner />
      </TooltipProvider>
    </SessionProvider>
  );
}
