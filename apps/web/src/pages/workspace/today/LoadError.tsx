import { TriangleAlertIcon } from "lucide-react";
import type { ApiFailure } from "@/api";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A load that failed (NAV-12): what the server said, and a way to try again. The last answer stays on screen under it. */
export function LoadError({
  error,
  what,
  onRetry,
}: {
  error: ApiFailure;
  /** What could not be loaded: "today's roll". */
  what: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}
