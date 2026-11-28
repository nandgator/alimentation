import { NotAvailable } from "@/components/app";
import { useWorkspace } from "../context.tsx";
import { AdminHome } from "./AdminHome.tsx";
import { ConsumerHome } from "./ConsumerHome.tsx";

/**
 * `/w/:slug`: each role's own Home (D5). The admin's is the kitchen at a glance, the consumer's is their bill and
 * their next meals. A cook's Home is Today, and the shell sends them there; this is only the guard.
 */
export function Home() {
  const ws = useWorkspace();
  if (ws.role === "admin") return <AdminHome />;
  if (ws.role === "consumer") return <ConsumerHome />;
  return (
    <NotAvailable title="Your home is Today" backTo={`${ws.base}/today`} backLabel="Go to Today">
      Cooks start from Today.
    </NotAvailable>
  );
}
