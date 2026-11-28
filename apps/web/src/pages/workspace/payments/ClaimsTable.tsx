import type { ClaimDto } from "@alimentation/core";
import type { ReactNode } from "react";
import { type DataColumn, DataTable, Money, StatusBadge } from "@/components/app";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { date, month } from "@/format";
import { useWorkspace } from "../context.tsx";
import { badgeOf, totalOf, waited } from "./claims.ts";

export interface ClaimActions {
  /** The cook decides; nobody else can. */
  confirm(c: ClaimDto): void;
  dispute(c: ClaimDto): void;
  withdraw(c: ClaimDto): void;
  /** The admin takes a decision back. */
  reverse(c: ClaimDto): void;
}

/** What the status cell says under the badge: how long it has waited, or why it was disputed or reversed. */
function Notes({ c }: { c: ClaimDto }) {
  const ws = useWorkspace();
  const lines = [
    c.status === "Pending" ? waited(c.createdAt, ws.boot.today, ws.boot.workspace.timeZone) : null,
    c.decisionNote,
    c.reversalReason ? `Reversed: ${c.reversalReason}` : null,
  ].filter((l): l is string => !!l);
  return lines.map((l) => (
    <span key={l} className="block text-xs text-muted-foreground">
      {l}
    </span>
  ));
}

/**
 * One table of claims, one row per claim (DAT-10). The actions are in each row's menu: what a role may do to a claim
 * is the server's rule, so only those are offered. The footer is the total for the rows shown.
 */
export function ClaimsTable({
  claims,
  actions,
  loading,
  empty,
  showPerson,
  canDecide,
}: {
  claims: ClaimDto[];
  actions: ClaimActions;
  loading?: boolean;
  empty: ReactNode;
  /** The admin and the cook see whose payment it is; a consumer sees only their own. */
  showPerson: boolean;
  canDecide: boolean;
}) {
  const ws = useWorkspace();
  const name = (c: ClaimDto) => ws.nameOf(c.consumerId);

  const columns: DataColumn<ClaimDto>[] = [
    ...(showPerson
      ? [
          {
            id: "person",
            header: "Person",
            cell: (c: ClaimDto) => <span className="font-medium">{name(c)}</span>,
            sort: name,
            search: (c: ClaimDto) => `${name(c)} ${c.refNote ?? ""}`,
          },
        ]
      : []),
    { id: "month", header: "Month", cell: (c) => month(c.forMonth), sort: (c) => c.forMonth },
    {
      id: "amount",
      header: "Amount",
      align: "end",
      cell: (c) => <Money paise={c.amount} fraction />,
      sort: (c) => c.amount,
    },
    {
      id: "method",
      header: "Method",
      cell: (c) => (
        <>
          {c.method}
          {c.refNote ? (
            <span className="block max-w-48 truncate text-xs text-muted-foreground">
              {c.refNote}
            </span>
          ) : null}
        </>
      ),
      facet: { label: "Method", value: (c) => c.method },
    },
    {
      id: "paidAt",
      header: "Paid on",
      cell: (c) => date(c.paidAt.slice(0, 10)),
      sort: (c) => c.paidAt,
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => {
        const b = badgeOf(c);
        return (
          <>
            <StatusBadge status={b.status} label={b.label} />
            <Notes c={c} />
          </>
        );
      },
    },
  ];

  const canWithdraw = (c: ClaimDto) => c.status === "Pending" && ws.role !== "supplier";
  const canReverse = (c: ClaimDto) =>
    ws.role === "admin" && (c.status === "Confirmed" || c.status === "Disputed");
  const canDecideThis = (c: ClaimDto) => canDecide && c.status === "Pending";

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        data={claims}
        columns={columns}
        getRowId={(c) => c.id}
        caption={showPerson ? "Payments" : "My payments"}
        searchable={showPerson}
        loading={loading}
        empty={empty}
        initialSort={{ id: "paidAt", desc: true }}
        rowLabel={(c) => `${showPerson ? `${name(c)}, ` : ""}${month(c.forMonth)} payment`}
        mobile={{
          title: (c) => (showPerson ? `${name(c)} · ${month(c.forMonth)}` : month(c.forMonth)),
          description: (c) => (
            <>
              {c.method} · {date(c.paidAt.slice(0, 10))}
              {c.refNote ? <span className="block text-xs">{c.refNote}</span> : null}
              <Notes c={c} />
            </>
          ),
          trailing: (c) => (
            <span className="flex flex-col items-end gap-1">
              <Money paise={c.amount} fraction className="font-medium" />
              <StatusBadge {...badgeOf(c)} />
            </span>
          ),
        }}
        rowActions={
          ws.writable
            ? (c) => {
                const items = [
                  canDecideThis(c) ? (
                    <DropdownMenuItem key="confirm" onClick={() => actions.confirm(c)}>
                      Confirm
                    </DropdownMenuItem>
                  ) : null,
                  canDecideThis(c) ? (
                    <DropdownMenuItem key="dispute" onClick={() => actions.dispute(c)}>
                      Dispute
                    </DropdownMenuItem>
                  ) : null,
                  canWithdraw(c) ? (
                    <DropdownMenuItem key="withdraw" onClick={() => actions.withdraw(c)}>
                      Withdraw
                    </DropdownMenuItem>
                  ) : null,
                  canReverse(c) ? (
                    <DropdownMenuItem
                      key="reverse"
                      variant="destructive"
                      onClick={() => actions.reverse(c)}
                    >
                      Reverse
                    </DropdownMenuItem>
                  ) : null,
                ].filter(Boolean);
                return items.length > 0 ? (
                  items
                ) : (
                  <DropdownMenuItem disabled>Nothing to do here</DropdownMenuItem>
                );
              }
            : undefined
        }
      />
      {claims.length > 0 ? (
        <p className="flex justify-between gap-3 px-1 text-sm">
          <span className="text-muted-foreground">
            {claims.length === 1 ? "1 payment" : `${claims.length} payments`}
            {claims.some((c) => c.status === "Reversed") ? ", reversed ones not counted" : ""}
          </span>
          <span>
            <span className="text-muted-foreground">Total </span>
            <Money paise={totalOf(claims)} fraction className="font-semibold" />
          </span>
        </p>
      ) : null}
    </div>
  );
}
