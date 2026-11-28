import { CompassIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "./PageHeader";

/**
 * For a 404, a screen this role may not open, and a kitchen the person is not a member of (NAV-10): one page, one
 * way out. It has its own H1 and title, so focus and the document title follow like any route.
 */
export function NotAvailable({
  title = "Not available",
  children = "It may have moved, or your role here does not include it.",
  backTo,
  backLabel = "Go back",
}: {
  title?: string;
  children?: ReactNode;
  /** Where the one action leads; omitted, it goes to the root. */
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title={title} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CompassIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This page is not available</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href={backTo ?? "/"} />} nativeButton={false}>
            {backLabel}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
