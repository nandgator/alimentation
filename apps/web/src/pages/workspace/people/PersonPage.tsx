import type {
  ClaimDto,
  LogEntryDto,
  MealStatementDto,
  Role,
  StatementDto,
} from "@alimentation/core";
import { PencilIcon, SendIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import {
  type DataColumn,
  DataTable,
  EmptyState,
  Money,
  NotAvailable,
  PageHeader,
  type Status,
  StatusBadge,
  UrlMonthPicker,
} from "@/components/app";
import { shiftMonth } from "@/components/app/MonthPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { date, month, monthLong } from "@/format";
import { useUrlState } from "@/hooks/use-url-state";
import { describeEntry, serviceName } from "../../../catalogue.ts";
import { useWorkspace } from "../context.tsx";
import { ROLE_LABEL } from "../sections.ts";
import { canInvite, detailLine, groupPeople, isDisabled, type Member } from "./model.ts";
import { usePersonDialogs } from "./PersonDialogs.tsx";
import { accountStatus, RoleBadges, useEats } from "./shared.tsx";
import { useFetch } from "./useFetch.ts";

const isMoney = (s: StatementDto | MealStatementDto): s is StatementDto => "liveTotal" in s;

const dash = <span className="text-muted-foreground">-</span>;

/** A statement's state, in the app's status words. */
function statementStatus(s: StatementDto): { status: Status; label?: string } | null {
  switch (s.status) {
    case "SETTLED":
      return { status: "paid" };
    case "DUE":
      return { status: "owed" };
    case "PART_PAID":
      return { status: "owed", label: "Part paid" };
    case "AWAITING_CONFIRMATION":
      return { status: "pending", label: "Awaiting confirmation" };
    case "QUERY_OPEN":
      return { status: "disputed", label: "Query open" };
    case "CHANGED_AFTER_CLOSE":
      return { status: "overdue", label: "Changed after close" };
    case "PROJECTED":
      return { status: "projected" };
    default:
      return null;
  }
}

const CLAIM_STATUS: Record<ClaimDto["status"], { status: Status; label?: string }> = {
  Pending: { status: "pending" },
  Confirmed: { status: "confirmed" },
  Disputed: { status: "disputed" },
  Reversed: { status: "disabled", label: "Reversed" },
};

function Details({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({ member }: { member: Member }) {
  const ws = useWorkspace();
  const eats = useEats();
  const row = member.rows.find((r) => r.role === "consumer");
  const mine = row ? ws.boot.enrolments.filter((e) => e.personId === row.id) : [];
  const several = ws.boot.services.length >= 2;
  const st = row
    ? ws.boot.statements.find((s) => s.personId === row.id && s.month === ws.boot.currentMonth)
    : undefined;
  const bill = st && isMoney(st) ? st : undefined;
  const p = member.main;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Details
            rows={[
              ["Roles", <RoleBadges key="r" roles={member.roles} />],
              ["Account", <StatusBadge key="a" status={accountStatus(member)} />],
              ["Key", member.rows.find((r) => r.externalKey)?.externalKey ?? dash],
              ["Contact", p.contact ?? dash],
              ...(row
                ? ([
                    ["Eating from", row.activeFrom ? date(row.activeFrom) : dash],
                    ["Until", row.activeTo ? date(row.activeTo) : dash],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
        </CardContent>
      </Card>
      {row ? (
        <Card>
          <CardHeader>
            <CardTitle>{monthLong(ws.boot.currentMonth)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Details
              rows={[
                ...(several
                  ? ([["Eats", eats(member) || dash]] as [string, React.ReactNode][])
                  : []),
                ["Meals", st ? String(st.counts.meals) : dash],
                ["Days on leave", st ? String(st.counts.leave) : dash],
                ...(ws.money && bill
                  ? ([
                      [
                        bill.balance > 0 ? "Owes" : "Balance",
                        bill.balance < 0 ? (
                          <Money key="b" paise={-bill.balance} credit />
                        ) : (
                          <Money key="b" paise={bill.balance} />
                        ),
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {several && mine.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-medium">Services</p>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {mine
                    .slice()
                    .sort((a, b) => (a.activeFrom < b.activeFrom ? 1 : -1))
                    .map((e) => (
                      <li key={`${e.serviceId}-${e.activeFrom}`}>
                        {serviceName(ws.boot, e.serviceId)}: from {date(e.activeFrom)}
                        {e.activeTo ? ` until ${date(e.activeTo)}` : ""}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Meals({ personId }: { personId: string }) {
  const ws = useWorkspace();
  const [m] = useUrlState("month", ws.boot.currentMonth);
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const log = useFetch<LogEntryDto[]>(
    `${ws.api}/log?from=${m}-01&to=${m}-${String(last).padStart(2, "0")}`,
  );
  const rows = useMemo(
    () => (log.data ?? []).filter((e) => e.personId === personId),
    [log.data, personId],
  );
  const columns: DataColumn<LogEntryDto>[] = [
    { id: "date", header: "Day", sort: (e) => e.date, cell: (e) => date(e.date) },
    {
      id: "what",
      header: "Entry",
      search: (e) => describeEntry(ws.boot, e),
      cell: (e) => describeEntry(ws.boot, e).replace(/^Leave\b/, "Skip"),
    },
    { id: "note", header: "Note", search: (e) => e.note, cell: (e) => e.note ?? dash },
    {
      id: "by",
      header: "Logged",
      cell: (e) => (
        <span>
          {e.by}
          {e.lateByDays > 0 ? (
            <span className="block text-xs text-muted-foreground">
              Added {e.lateByDays} {e.lateByDays === 1 ? "day" : "days"} after
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <UrlMonthPicker fallback={ws.boot.currentMonth} max={shiftMonth(ws.boot.currentMonth, 1)} />
      </div>
      {log.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            {log.error}
            <Button type="button" size="sm" variant="outline" onClick={log.reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(e) => e.id}
        caption="Meal entries"
        loading={log.loading && !log.data}
        initialSort={{ id: "date", desc: true }}
        empty={
          <EmptyState
            title={`No entries in ${monthLong(m)}`}
            description="Leave, switches and extras logged for this person appear here. A day with none was eaten as planned."
          />
        }
        mobile={{
          title: (e) => `${date(e.date)}: ${describeEntry(ws.boot, e).replace(/^Leave\b/, "Skip")}`,
          description: (e) => e.note ?? e.by,
        }}
      />
    </div>
  );
}

function Payments({ personId }: { personId: string }) {
  const ws = useWorkspace();
  const claims = useFetch<ClaimDto[]>(`${ws.api}/claims`);
  const rows = useMemo(
    () => (claims.data ?? []).filter((c) => c.consumerId === personId),
    [claims.data, personId],
  );
  const columns: DataColumn<ClaimDto>[] = [
    { id: "month", header: "Month", sort: (c) => c.forMonth, cell: (c) => month(c.forMonth) },
    {
      id: "amount",
      header: "Amount",
      align: "end",
      sort: (c) => c.amount,
      cell: (c) => <Money paise={c.amount} fraction />,
    },
    { id: "method", header: "Method", cell: (c) => c.method },
    {
      id: "paid",
      header: "Paid on",
      sort: (c) => c.paidAt,
      cell: (c) => date(c.paidAt.slice(0, 10)),
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge {...CLAIM_STATUS[c.status]} />
          {c.status === "Disputed" && c.decisionNote ? (
            <span className="text-xs text-muted-foreground">{c.decisionNote}</span>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {claims.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            {claims.error}
            <Button type="button" size="sm" variant="outline" onClick={claims.reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(c) => c.id}
        caption="Payments"
        searchable={false}
        loading={claims.loading && !claims.data}
        initialSort={{ id: "paid", desc: true }}
        empty={
          <EmptyState
            title="No payments yet"
            description="Payments this person says they made, and what the kitchen decided, are listed here."
          />
        }
        mobile={{
          title: (c) => `${month(c.forMonth)} · ${c.method}`,
          description: (c) => date(c.paidAt.slice(0, 10)),
          trailing: (c) => <StatusBadge {...CLAIM_STATUS[c.status]} />,
        }}
      />
    </div>
  );
}

function Bill({ personId }: { personId: string }) {
  const ws = useWorkspace();
  const rows = ws.boot.statements.filter(
    (s): s is StatementDto => s.personId === personId && isMoney(s),
  );
  const columns: DataColumn<StatementDto>[] = [
    {
      id: "month",
      header: "Month",
      sort: (s) => s.month,
      cell: (s) => (
        <Link
          href={`${ws.base}/bills/${personId}?month=${s.month}`}
          className="rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {month(s.month)}
        </Link>
      ),
    },
    {
      id: "billed",
      header: "Billed",
      align: "end",
      sort: (s) => (s.closed ? s.billed : s.liveTotal),
      cell: (s) => <Money paise={s.closed ? s.billed : s.liveTotal} fraction />,
    },
    {
      id: "paid",
      header: "Paid",
      align: "end",
      sort: (s) => s.paid,
      cell: (s) => <Money paise={s.paid} fraction />,
    },
    {
      id: "balance",
      header: "Balance",
      align: "end",
      sort: (s) => s.balance,
      cell: (s) =>
        s.balance < 0 ? (
          <Money paise={-s.balance} credit fraction />
        ) : (
          <Money paise={s.balance} fraction />
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => {
        const x = statementStatus(s);
        return x ? <StatusBadge {...x} /> : dash;
      },
    },
  ];
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(s) => s.month}
      caption="Bills"
      searchable={false}
      initialSort={{ id: "month", desc: true }}
      empty={
        <EmptyState
          title="No bills yet"
          description="A bill appears here once the person has meals in a month."
        />
      }
      mobile={{
        title: (s) => month(s.month),
        description: (s) => (s.balance < 0 ? "Credit" : "Balance"),
        trailing: (s) => <Money paise={Math.abs(s.balance)} credit={s.balance < 0} fraction />,
      }}
    />
  );
}

/** One person: who they are, what they ate, what they paid and what they owe, in tabs kept in the address. */
export function PersonPage({ id }: { id: string }) {
  const ws = useWorkspace();
  const dialogs = usePersonDialogs();
  const [tabRaw, setTab] = useUrlState("tab", "overview");
  const member = useMemo(
    () => groupPeople(ws.boot.people).find((m) => m.rows.some((r) => r.id === id)),
    [ws.boot.people, id],
  );
  if (!member)
    return (
      <NotAvailable
        title="Person not found"
        backTo={`${ws.base}/people`}
        backLabel="Back to People"
      >
        They may have been removed, or the link may be wrong.
      </NotAvailable>
    );

  const consumer = member.rows.find((r) => r.role === "consumer");
  const tabs: { value: string; label: string }[] = [
    { value: "overview", label: "Overview" },
    ...(consumer
      ? [
          { value: "meals", label: "Meals" },
          ...(ws.money
            ? [
                { value: "payments", label: "Payments" },
                { value: "bill", label: "Bill" },
              ]
            : []),
        ]
      : []),
  ];
  const tab = tabs.some((t) => t.value === tabRaw) ? tabRaw : "overview";
  const off = isDisabled(member);
  const roles: Role[] = member.roles;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <PageHeader
        title={member.main.name}
        description={[
          roles.map((r) => ROLE_LABEL[r]).join(", "),
          off ? "Disabled" : "",
          detailLine(member.main),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {canInvite(member) && !off ? (
              <Button type="button" disabled={!ws.writable} onClick={() => dialogs.invite(member)}>
                <SendIcon aria-hidden="true" data-icon="inline-start" />
                Invite
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={!ws.writable}
              onClick={() => dialogs.edit(member)}
            >
              <PencilIcon aria-hidden="true" data-icon="inline-start" />
              Edit
            </Button>
            {off ? (
              <Button
                type="button"
                variant="outline"
                disabled={!ws.writable}
                onClick={() => dialogs.enable(member)}
              >
                Enable
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!ws.writable}
                onClick={() => dialogs.disable(member)}
              >
                Disable
              </Button>
            )}
          </>
        }
        tabs={
          tabs.length > 1 ? (
            <TabsList variant="line" aria-label={`${member.main.name}, sections`}>
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : null
        }
      />
      <TabsContent value="overview">
        <Overview member={member} />
      </TabsContent>
      {consumer ? (
        <TabsContent value="meals">
          <Meals personId={consumer.id} />
        </TabsContent>
      ) : null}
      {consumer && ws.money ? (
        <>
          <TabsContent value="payments">
            <Payments personId={consumer.id} />
          </TabsContent>
          <TabsContent value="bill">
            <Bill personId={consumer.id} />
          </TabsContent>
        </>
      ) : null}
      {dialogs.node}
    </Tabs>
  );
}
