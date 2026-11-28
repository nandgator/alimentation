import { CheckCircle2Icon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { setupChecklist, setupProgress } from "../../../setup.ts";
import { CardHeading } from "../bills/StatCard.tsx";
import { useWorkspace } from "../context.tsx";

/**
 * What the kitchen still has to set up (NAV-12), as a task list with a count: People, what is served, the menu and
 * the prices. It is the admin's alone, and it is gone once every step is done. Each row is a link to its screen.
 */
export function SetupChecklist() {
  const ws = useWorkspace();
  const { boot } = ws;
  const steps = setupChecklist({
    money: ws.money,
    today: boot.today,
    hints: boot.setup,
    services: boot.services,
    catalogue: boot.catalogue,
  });
  const progress = setupProgress(steps);
  if (!progress) return null;
  const next = steps.find((s) => !s.done);
  return (
    <Card aria-labelledby="setup-title">
      <CardHeader>
        <CardTitle>
          <CardHeading id="setup-title">Set up your kitchen</CardHeading>
        </CardTitle>
        <CardDescription>{progress}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y rounded-lg border">
          {steps.map((s) => (
            <li key={s.key}>
              <Link
                href={`${ws.base}${s.to}`}
                className={cn(
                  "flex min-h-11 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                  s.key === next?.key && "bg-accent/40",
                )}
              >
                {s.done ? (
                  <CheckCircle2Icon
                    className="size-5 shrink-0 text-success-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleIcon
                    className="size-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", s.done && "text-muted-foreground")}>
                    {s.label}
                    <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                  </span>
                  {s.done ? null : (
                    <span className="block text-sm text-muted-foreground">{s.hint}</span>
                  )}
                </span>
                <ChevronRightIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
