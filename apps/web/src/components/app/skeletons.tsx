import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { cn } from "@/lib/utils";

const slots = (n: number) => Array.from({ length: n }, (_, i) => `slot-${i}`);

/** Shared frame: announces itself politely and keeps the page's shape so nothing jumps when data arrives. */
function Frame({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn("w-full", className)}>
      {children}
    </div>
  );
}

export function StatsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Frame label="Loading figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {slots(count).map((i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-3 h-3 w-40" />
        </div>
      ))}
    </Frame>
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <Frame label="Loading the table" className="rounded-xl border">
      <div className="flex gap-4 border-b p-3">
        {slots(columns).map((i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {slots(rows).map((r) => (
        <div key={r} className="flex gap-4 border-b p-3 last:border-b-0">
          {slots(columns).map((i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </Frame>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Frame label="Loading the list" className="flex flex-col gap-2">
      {slots(rows).map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </Frame>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Frame label="Loading the form" className="flex max-w-lg flex-col gap-5">
      {slots(fields).map((i) => (
        <div key={i}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-11 w-full pointer-fine:h-9" />
        </div>
      ))}
      <Skeleton className="h-11 w-32 pointer-fine:h-9" />
    </Frame>
  );
}

const VARIANTS = {
  stats: StatsSkeleton,
  table: TableSkeleton,
  list: ListSkeleton,
  form: FormSkeleton,
} as const;

/**
 * A page's loading state: renders the skeleton only once the load has taken 150ms, and keeps it at least 300ms
 * (NAV-08). Before that, and when not loading, it renders nothing, so `children` can be shown in its place:
 * `<PageSkeleton loading={q.loading} variant="table">{content}</PageSkeleton>`.
 */
export function PageSkeleton({
  loading,
  variant,
  children,
}: {
  loading: boolean;
  variant: keyof typeof VARIANTS;
  children?: ReactNode;
}) {
  const show = useDelayedLoading(loading);
  if (show) {
    const V = VARIANTS[variant];
    return <V />;
  }
  // Within the grace delay the page is blank rather than a flash of text; once loaded, the content.
  return loading ? null : children;
}
