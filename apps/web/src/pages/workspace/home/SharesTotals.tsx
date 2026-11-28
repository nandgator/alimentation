import { useWorkspace } from "../context.tsx";

/**
 * Said to everyone in a kitchen that shares its totals with a head office, so nobody is counted without knowing:
 * what is shared, and with whom. Nothing is shown for a kitchen that shares nothing.
 */
export function SharesTotals() {
  const ws = useWorkspace();
  const head = ws.boot.organisation;
  if (!head) return null;
  return (
    <p className="text-sm text-muted-foreground">
      This kitchen shares its totals (how many people and how many meals
      {ws.money ? ", and what is billed, paid and owed" : ""}, with no names) with {head.name}.
    </p>
  );
}
