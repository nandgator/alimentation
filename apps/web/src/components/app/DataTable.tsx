import type { PaginationState, RowData, SortingState } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type LegacyColumnDef,
  type LegacyRow,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsNarrow } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./skeletons";

export interface DataColumn<T> {
  id: string;
  /** The column heading, and what the sort button is called. */
  header: string;
  /** What a cell shows. */
  cell: (row: T) => ReactNode;
  /** Makes the column sortable by this value. Numbers sort as numbers, text without regard to case. */
  sort?: (row: T) => string | number | null | undefined;
  /** Text matched by the search box. Columns without it are not searched. */
  search?: (row: T) => string | null | undefined;
  /** Makes the column a faceted filter: the distinct values of this function become a menu of choices. */
  facet?: { label: string; value: (row: T) => string | null | undefined };
  /** Amounts, counts and dates are `end` (right-aligned, tabular). */
  align?: "start" | "end";
  /** Hide the column below this width. Phones show the `mobile` list instead of columns. */
  className?: string;
}

/** How one row looks as an item on a phone, where the table becomes a list (DAT-14). */
export interface MobileRow<T> {
  title: (row: T) => ReactNode;
  description?: (row: T) => ReactNode;
  /** Right side: usually the amount or a StatusBadge. */
  trailing?: (row: T) => ReactNode;
}

export interface DataTableProps<T extends RowData> {
  data: T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  /** What the table is, for assistive technology ("People"). */
  caption: string;
  mobile: MobileRow<T>;
  /** Shows a skeleton instead of rows. */
  loading?: boolean;
  /** Shown when there are no rows at all (not when a search finds none). */
  empty?: ReactNode;
  /** A search box over the columns that have `search`. Default true. */
  searchable?: boolean;
  searchLabel?: string;
  pageSize?: number;
  /** Items for the row's actions menu (DropdownMenuItem …). The menu is the last column, headed "Actions" for screen readers only. */
  rowActions?: (row: T) => ReactNode;
  /** Names a row for its actions button ("Actions for Jovial"). */
  rowLabel?: (row: T) => string;
  /** Opens a row. On a phone it is the row's title that is pressed; on desktop the whole row also takes a click, so keep a real link or button in the first cell for the keyboard. */
  onRowClick?: (row: T) => void;
  /** Extra controls beside the search box (a MonthPicker, an Add button). */
  toolbar?: ReactNode;
  /** Draw a sticky first column when the table scrolls sideways. Default true. */
  stickyFirst?: boolean;
  /** Initial sort: a column id, descending or not. */
  initialSort?: { id: string; desc?: boolean };
}

const compare = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
};

/**
 * The table (DAT-01, DAT-14), on TanStack: sortable headings, a search box, faceted filters, "1-50 of N" paging, a
 * sticky header and first column with a shadow where more is out of sight, a row-actions menu. Below 768px it is a
 * list of Items drawn from `mobile`, so nothing scrolls sideways on a phone.
 */
export function DataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  caption,
  mobile,
  loading,
  empty,
  searchable = true,
  searchLabel = "Search",
  pageSize = 50,
  rowActions,
  rowLabel,
  onRowClick,
  toolbar,
  stickyFirst = true,
  initialSort,
}: DataTableProps<T>) {
  const narrow = useIsNarrow();
  const [sorting, setSorting] = useState<SortingState>(
    initialSort ? [{ id: initialSort.id, desc: !!initialSort.desc }] : [],
  );
  const [globalFilter, setGlobalFilter] = useState("");
  const [facets, setFacets] = useState<Record<string, string>>({});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });

  const facetCols = useMemo(
    () => columns.flatMap((c) => (c.facet ? [{ id: c.id, ...c.facet }] : [])),
    [columns],
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        facetCols.map((f) => [
          f.id,
          [...new Set(data.map((r) => f.value(r)).filter((v): v is string => !!v))].sort(compare),
        ]),
      ),
    [data, facetCols],
  );
  const visible = useMemo(
    () => data.filter((r) => facetCols.every((f) => !facets[f.id] || f.value(r) === facets[f.id])),
    [data, facets, facetCols],
  );

  const defs = useMemo<LegacyColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (r: T) => (c.sort ? c.sort(r) : null),
        enableSorting: !!c.sort,
        sortingFn: (a: LegacyRow<T>, b: LegacyRow<T>, id: string) =>
          compare(a.getValue(id), b.getValue(id)),
      })),
    [columns],
  );

  const table = useLegacyTable<T>({
    data: visible,
    columns: defs,
    getRowId,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _id, value) => {
      const q = String(value ?? "")
        .trim()
        .toLowerCase();
      if (!q) return true;
      return columns.some((c) => c.search?.(row.original)?.toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // A new search or filter starts on the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these only
  useEffect(() => setPagination((p) => ({ ...p, pageIndex: 0 })), [globalFilter, facets]);

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const pages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const first = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const last = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize);

  // Shadows at the edges where the table has more to scroll to.
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when the shape changes
  useEffect(measure, [rows.length, narrow, loading, columns]);

  const actionsFor = (r: T) =>
    rowActions ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={rowLabel ? `Actions for ${rowLabel(r)}` : "Actions"}
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{rowActions(r)}</DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const anyFilter = !!globalFilter || Object.values(facets).some(Boolean);
  const hasSearch = searchable && columns.some((c) => c.search);

  if (loading) return <TableSkeleton />;
  if (data.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="flex flex-col gap-3">
      {hasSearch || facetCols.length > 0 || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasSearch ? (
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label={searchLabel}
                placeholder={`${searchLabel}…`}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </InputGroup>
          ) : null}
          {facetCols.map((c) => (
            <NativeSelect
              key={c.id}
              aria-label={c.label}
              className="w-auto"
              value={facets[c.id] ?? ""}
              onChange={(e) => setFacets((f) => ({ ...f, [c.id]: e.target.value }))}
            >
              <NativeSelectOption value="">{`All ${c.label.toLowerCase()}`}</NativeSelectOption>
              {options[c.id]?.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ))}
          {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={anyFilter ? "Nothing matches" : "Nothing here yet"}
          description={anyFilter ? "Try a different search or clear the filters." : undefined}
          action={
            anyFilter ? (
              <Button
                variant="outline"
                onClick={() => {
                  setGlobalFilter("");
                  setFacets({});
                }}
              >
                Clear search and filters
              </Button>
            ) : undefined
          }
        />
      ) : narrow ? (
        <ItemGroup className="gap-2" aria-label={caption}>
          {rows.map((row) => {
            const r = row.original;
            return (
              <Item key={row.id} variant="outline" size="sm" role="listitem">
                <ItemContent>
                  {onRowClick ? (
                    <button
                      type="button"
                      className="flex flex-col gap-0.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => onRowClick(r)}
                    >
                      <ItemTitle>{mobile.title(r)}</ItemTitle>
                      {mobile.description ? (
                        <ItemDescription>{mobile.description(r)}</ItemDescription>
                      ) : null}
                    </button>
                  ) : (
                    <>
                      <ItemTitle>{mobile.title(r)}</ItemTitle>
                      {mobile.description ? (
                        <ItemDescription>{mobile.description(r)}</ItemDescription>
                      ) : null}
                    </>
                  )}
                </ItemContent>
                <ItemActions>
                  {mobile.trailing?.(r)}
                  {actionsFor(r)}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <div className="relative rounded-xl border">
          <div
            ref={scroller}
            onScroll={measure}
            className="max-h-[70dvh] overflow-auto rounded-xl"
            // A scrollable region is reachable by keyboard so it can be scrolled without a pointer.
            tabIndex={0}
            role="region"
            aria-label={`${caption}, scrollable`}
          >
            <table className="w-full caption-bottom text-sm" aria-label={caption}>
              <TableHeader className="sticky top-0 z-10 bg-card">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((h, i) => {
                      const col = columns.find((c) => c.id === h.column.id);
                      if (!col) return null;
                      const sorted = h.column.getIsSorted();
                      return (
                        <TableHead
                          key={h.id}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : undefined
                          }
                          className={cn(
                            col.align === "end" && "text-right",
                            stickyFirst && i === 0 && "sticky left-0 z-20 bg-card",
                            edges.left && i === 0 && "shadow-[1px_0_0_var(--border)]",
                            col.className,
                          )}
                        >
                          {col.sort ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "-mx-2.5 font-medium",
                                col.align === "end" && "flex-row-reverse",
                              )}
                              onClick={h.column.getToggleSortingHandler()}
                            >
                              {col.header}
                              {sorted === "asc" ? (
                                <ArrowUpIcon aria-hidden="true" />
                              ) : sorted === "desc" ? (
                                <ArrowDownIcon aria-hidden="true" />
                              ) : (
                                <ArrowUpDownIcon aria-hidden="true" className="opacity-50" />
                              )}
                            </Button>
                          ) : (
                            col.header
                          )}
                        </TableHead>
                      );
                    })}
                    {rowActions ? (
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  >
                    {columns.map((col, i) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          col.align === "end" && "text-right tabular-nums",
                          stickyFirst &&
                            i === 0 &&
                            "sticky left-0 z-[1] bg-background group-hover/row:bg-muted",
                          edges.left && i === 0 && "shadow-[1px_0_0_var(--border)]",
                          col.className,
                        )}
                      >
                        {col.cell(row.original)}
                      </TableCell>
                    ))}
                    {rowActions ? (
                      <TableCell className="w-12 text-right" onClick={(e) => e.stopPropagation()}>
                        {actionsFor(row.original)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          {edges.right ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-xl bg-gradient-to-l from-foreground/10 to-transparent"
            />
          ) : null}
        </div>
      )}

      {total > 0 ? (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <p aria-live="polite" className="tabular-nums">
            {pages > 1
              ? `${first}-${last} of ${total}`
              : `${total} ${total === 1 ? "row" : "rows"}`}
          </p>
          {pages > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
