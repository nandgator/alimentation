import { useLocation } from "wouter";
import { Bills } from "../bills/Bills.tsx";
import { Statement } from "../bills/Statement.tsx";
import { useWorkspace } from "../context.tsx";
import { Home } from "./Home.tsx";

/**
 * TODO(WP2): point `shell/views.tsx` at `Home` (home/Home.tsx), `Bills` and `Statement` (bills/), then delete this file.
 * Until then the one name the shell imports serves all three, by the address it is opened at.
 */
export function Dashboard() {
  const { base } = useWorkspace();
  const [location] = useLocation();
  const rest = location.slice(base.length);
  if (rest.startsWith("/bills/")) return <Statement />;
  if (rest.startsWith("/bills")) return <Bills />;
  return <Home />;
}
