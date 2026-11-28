import { type ReactNode, useCallback, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { archivedWords } from "../../../retention.ts";

/**
 * The few pieces the five Books screens share: a loader that keeps what it has while it fetches again, the words
 * for a refusal, an inline error with "Try again", and a card with a real heading.
 */

export { useLoad } from "../../../hooks/use-load.ts";

/** What a refusal says, in words meant to be read: a handed-over month is explained, nothing is a code. */
export const refusalWords = (e: unknown): string =>
  e instanceof Error
    ? (archivedWords(e as { code?: string; extra?: Record<string, unknown> }) ?? e.message)
    : "Something went wrong. Try again.";

/** An action that may be refused: `run` returns whether it went through, and `error` holds the refusal. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(refusalWords(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

/** A load that failed: said in words, with a way to try again. What was on screen stays above it. */
export function LoadProblem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{refusalWords(error)}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** A refusal from an action, shown where the action was. */
export function ActionProblem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

/** A card that is a region of the page with a heading of its own. */
export function Section({
  title,
  label,
  description,
  children,
  className,
}: {
  title: string;
  /** The region's name when it differs from the heading. */
  label?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card role="region" aria-label={label ?? title} className={className}>
      <CardHeader>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent className="flex flex-col gap-4">{children}</CardContent> : null}
    </Card>
  );
}

/** A file made in the browser and saved: what the person is given. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
