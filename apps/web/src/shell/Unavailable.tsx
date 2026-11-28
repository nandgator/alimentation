import { CompassIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";

/**
 * The answer to every address that is not for the person: a page that is not there, a screen of another
 * role, a kitchen they are not in. A page of its own, with the way out.
 */
// TODO(WP1): swap for components/app/NotAvailable once it is published; the words are the plan's (§5).
export function Unavailable({
  title,
  reason,
  home = "/app",
  homeLabel = "Go to your home",
  showKitchens = true,
}: {
  title: string;
  reason: string;
  home?: string;
  homeLabel?: string;
  showKitchens?: boolean;
}) {
  return (
    <Empty className="mx-auto max-w-lg py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CompassIcon />
        </EmptyMedia>
        <h1
          tabIndex={-1}
          data-slot="empty-title"
          className="text-xl font-semibold tracking-tight outline-none"
        >
          {title}
        </h1>
        <EmptyDescription>{reason}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button nativeButton={false} render={<Link href={home} />}>
          {homeLabel}
        </Button>
        {showKitchens ? (
          <Button variant="outline" nativeButton={false} render={<Link href="/app" />}>
            All kitchens
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
