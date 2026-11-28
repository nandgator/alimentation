import { Skeleton } from "@/components/ui/skeleton";

/**
 * What stands in for the shell and the page on a cold start, before anything is known: a sidebar column on a
 * wide screen, a top bar and a bottom bar on a phone, and the lines of a page between them. It says nothing,
 * and tells a screen reader only that the page is on its way.
 */
export function ShellSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Opening the kitchen"
      className="flex min-h-svh w-full bg-background"
    >
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r bg-sidebar p-3 lg:flex">
        <Skeleton className="h-12 w-full" />
        <div className="flex flex-col gap-2 pt-2">
          {Array.from({ length: 7 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of look-alikes
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="size-8 rounded-full lg:hidden" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto size-8 rounded-full" />
        </div>
        <div className="flex flex-col gap-4 p-4 lg:p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 flex h-16 items-center justify-around border-t bg-background lg:hidden">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of look-alikes
          <Skeleton key={i} className="h-8 w-12" />
        ))}
      </div>
    </div>
  );
}

/** The lines of a page alone, for the page region while the statement of a changed role is on its way. */
export function PageLines() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Opening the page"
      className="flex flex-col gap-4"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
