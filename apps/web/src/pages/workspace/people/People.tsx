import { peopleToCsv } from "@alimentation/core";
import { DownloadIcon, PlusIcon, UploadIcon, UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { type DataColumn, DataTable, EmptyState, PageHeader, StatusBadge } from "@/components/app";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { date } from "@/format";
import { useUrlState } from "@/hooks/use-url-state";
import { useWorkspace } from "../context.tsx";
import { ROLE_LABEL } from "../sections.ts";
import {
  canInvite,
  detailLine,
  groupPeople,
  isDisabled,
  isShow,
  type Member,
  type Show,
  showCounts,
  visibleMembers,
} from "./model.ts";
import { downloadCsv, ImportPeopleDialog } from "./PeopleImport.tsx";
import { usePersonDialogs } from "./PersonDialogs.tsx";
import { PersonPage } from "./PersonPage.tsx";
import { accountStatus, RoleBadges, useEats } from "./shared.tsx";

const SHOW_LABEL: Record<Show, string> = {
  all: "All",
  consumer: "Consumers",
  supplier: "Cooks",
  admin: "Admins",
  disabled: "Disabled",
};
const SHOW_EMPTY: Record<Show, string> = {
  all: "Nobody is here yet",
  consumer: "No consumers",
  supplier: "No cooks",
  admin: "No admins",
  disabled: "Nobody is disabled",
};

function PeopleList() {
  const ws = useWorkspace();
  const [, go] = useLocation();
  const dialogs = usePersonDialogs();
  const eats = useEats();
  const [importing, setImporting] = useState(false);
  const [showRaw, setShow] = useUrlState("show", "all");
  const show: Show = isShow(showRaw) ? showRaw : "all";
  const [action, setAction] = useUrlState("action");
  const several = ws.boot.services.filter((s) => s.archivedOn === null).length >= 2;

  // The search menu's "Add a person" arrives here with ?action=add.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the address that asked
  useEffect(() => {
    if (action === "add" && ws.writable) dialogs.add();
    if (action) setAction("");
  }, [action]);

  const members = useMemo(() => groupPeople(ws.boot.people), [ws.boot.people]);
  const counts = showCounts(members);
  const rows = visibleMembers(members, show);

  const columns = useMemo<DataColumn<Member>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        sort: (m) => m.main.name,
        search: (m) => `${m.main.name} ${detailLine(m.main)}`,
        cell: (m) => (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`${ws.base}/people/${m.id}`}
              onClick={(e) => e.stopPropagation()}
              className="w-fit rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {m.main.name}
            </Link>
            {detailLine(m.main) ? (
              <span className="text-xs text-muted-foreground">{detailLine(m.main)}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: "roles",
        header: "Roles",
        sort: (m) => m.roles.map((r) => ROLE_LABEL[r]).join(" "),
        cell: (m) => <RoleBadges roles={m.roles} />,
      },
      ...(several
        ? [
            {
              id: "eats",
              header: "Eats",
              className: "max-w-56 whitespace-normal",
              cell: (m: Member) => eats(m) || <span className="text-muted-foreground">-</span>,
            } satisfies DataColumn<Member>,
          ]
        : []),
      {
        id: "account",
        header: "Account",
        sort: (m) => accountStatus(m),
        cell: (m) => <StatusBadge status={accountStatus(m)} />,
      },
      {
        id: "from",
        header: "From",
        align: "end",
        sort: (m) => m.main.activeFrom ?? "",
        cell: (m) =>
          m.main.activeFrom ? (
            date(m.main.activeFrom)
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
    ],
    [ws.base, several, eats],
  );

  const exportButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => downloadCsv("people.csv", peopleToCsv(ws.boot.people))}
    >
      <DownloadIcon aria-hidden="true" data-icon="inline-start" />
      Export CSV
    </Button>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="People"
        description="Everyone you feed, and the people who help run the kitchen."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!ws.writable}
              onClick={() => setImporting(true)}
            >
              <UploadIcon aria-hidden="true" data-icon="inline-start" />
              Import
            </Button>
            <Button type="button" disabled={!ws.writable} onClick={dialogs.add}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              Add a person
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          aria-label="Show"
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap"
          value={[show]}
          onValueChange={(v) => setShow(((v[0] as Show | undefined) ?? "all") as string)}
        >
          {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
            <ToggleGroupItem key={s} value={s} aria-label={`${SHOW_LABEL[s]}, ${counts[s]}`}>
              {SHOW_LABEL[s]}
              <span className="text-muted-foreground tabular-nums">{counts[s]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {exportButton}
      </div>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(m) => m.id}
        caption="People"
        searchLabel="Search people"
        initialSort={{ id: "name" }}
        onRowClick={(m) => go(`${ws.base}/people/${m.id}`)}
        rowLabel={(m) => m.main.name}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={SHOW_EMPTY[show]}
            description={
              show === "all"
                ? "Add the people you feed, and anyone who helps run the kitchen."
                : "Nobody matches this filter."
            }
            action={
              show === "all" ? (
                <Button type="button" disabled={!ws.writable} onClick={dialogs.add}>
                  Add a person
                </Button>
              ) : undefined
            }
          />
        }
        mobile={{
          title: (m) => m.main.name,
          description: (m) =>
            [m.roles.map((r) => ROLE_LABEL[r]).join(", "), several ? eats(m) : ""]
              .filter(Boolean)
              .join(" · "),
          trailing: (m) => <StatusBadge status={accountStatus(m)} />,
        }}
        rowActions={(m) => (
          <>
            <DropdownMenuItem disabled={!ws.writable} onClick={() => dialogs.edit(m)}>
              Edit
            </DropdownMenuItem>
            {canInvite(m) && !isDisabled(m) ? (
              <DropdownMenuItem disabled={!ws.writable} onClick={() => dialogs.invite(m)}>
                Invite
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {isDisabled(m) ? (
              <DropdownMenuItem disabled={!ws.writable} onClick={() => dialogs.enable(m)}>
                Enable
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                disabled={!ws.writable}
                onClick={() => dialogs.disable(m)}
              >
                Disable
              </DropdownMenuItem>
            )}
          </>
        )}
      />

      <p className="mt-3 text-sm text-muted-foreground">
        {ws.boot.meter
          ? `${ws.boot.meter.usage.people} of the free tier’s people allowance used. `
          : ""}
        Disabling someone keeps their history and stops new entries.
      </p>

      {dialogs.node}
      <ImportPeopleDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}

/** People, and one person's page at `/people/:id`. */
export function People() {
  const { id } = useParams();
  return id ? <PersonPage id={id} /> : <PeopleList />;
}
