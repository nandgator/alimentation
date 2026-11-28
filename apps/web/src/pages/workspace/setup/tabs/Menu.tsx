import {
  DEFAULT_POLICY,
  dayName,
  type MenuVersion,
  must,
  type PolicyView,
  type Weekday,
} from "@alimentation/core";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { getJson, postJson } from "@/api";
import {
  DateField,
  EmptyState,
  FormField,
  PageSkeleton,
  toast,
  useAppForm,
} from "@/components/app";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsNarrow } from "@/hooks/use-media-query";
import { inOrder, itemName, liveOn, offerable, serviceName } from "../../../../catalogue.ts";
import { date } from "../../../../format.ts";
import {
  type Grid,
  gridFrom,
  menuBody,
  setCell,
  toggleOffered,
  unservedDays,
  unservedWords,
} from "../../../../menuGrid.ts";
import { useWorkspace } from "../../context.tsx";
import {
  ABOUT_DATE,
  aboutDate,
  CheckRow,
  FormModal,
  GroupField,
  LoadError,
  Section,
} from "../parts.tsx";
import { WEEK } from "../rulesForm.ts";
import { useLoad } from "../use-load.ts";

const NOT_SERVED = "";

const menuSchema = z.object({
  from: z.string().min(1, "Choose the date this menu starts"),
  note: z.string().max(500, "Use 500 characters or fewer"),
});

/**
 * What is served, from a date: for each day the kitchen cooks and each service, one meal or "Not served", and for
 * each service the items it also offers. A kitchen with one service sees one column and no service name anywhere.
 * On a phone the grid is a card for each day (the dialog is a full-height sheet there), on a wide screen a table.
 */
function MenuForm({
  last,
  working,
  onClose,
  onDone,
}: {
  last: MenuVersion | null;
  working: readonly Weekday[];
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const { boot } = ws;
  const narrow = useIsNarrow();
  const services = inOrder(liveOn(boot.services, boot.today));
  const several = services.length >= 2;
  const meals = offerable(boot, "meal", boot.today);
  const addOns = offerable(boot, "addon", boot.today);
  // The first menu starts with the month, as people and prices do; a later one starts today.
  const start = boot.menu ? boot.today : `${boot.today.slice(0, 7)}-01`;
  const form = useAppForm(menuSchema, { from: start, note: "" });
  const initial = useRef<Grid>(gridFrom(last, services, [...meals, ...addOns]));
  const [grid, setGrid] = useState<Grid>(initial.current);
  const ids = services.map((s) => s.id);
  const days = WEEK.filter((d) => working.includes(d));
  const unserved = unservedDays(grid, ids, days);
  const words = unservedWords(unserved);
  const cellLabel = (d: Weekday, sv: { name: string }) =>
    several ? `${dayName(d)}, ${sv.name}` : `Menu on ${dayName(d)}`;
  const select = (d: Weekday, sv: { id: string; name: string }) => (
    <NativeSelect
      aria-label={cellLabel(d, sv)}
      className="w-full"
      value={grid.cells[sv.id]?.[d] ?? NOT_SERVED}
      onChange={(e) => {
        // A refusal about the old grid is stale once the grid changes.
        form.clearErrors("root");
        setGrid(setCell(grid, sv.id, d, e.target.value));
      }}
    >
      <NativeSelectOption value={NOT_SERVED}>Not served</NativeSelectOption>
      {meals.map((m) => (
        <NativeSelectOption key={m.id} value={m.id}>
          {m.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  const note = form.watch("note");
  return (
    <FormModal
      form={form}
      title="New menu"
      description="A menu is never changed after the fact: a new one applies from its date onwards."
      submitLabel="Add menu"
      busyLabel="Adding…"
      onClose={onClose}
      serverFields={{ [ABOUT_DATE]: "from" }}
      changed={JSON.stringify(grid) !== JSON.stringify(initial.current)}
      onSubmit={async (v) => {
        if (words) throw new Error(words);
        try {
          await postJson(`${ws.api}/menus`, menuBody(grid, ids, days, v.from, v.note));
        } catch (e) {
          throw aboutDate(e);
        }
        toast.success(`Menu added from ${date(v.from)}.`);
        onDone();
      }}
    >
      <FormField name="from" label="Applies from">
        {(f) => (
          <DateField
            id={f.id}
            aria-invalid={f["aria-invalid"]}
            aria-describedby={f["aria-describedby"]}
            value={f.value}
            onChange={f.onChange}
            onBlur={f.onBlur}
            presets={false}
            today={boot.today}
            label="Menu applies from"
          />
        )}
      </FormField>

      <p className="text-sm text-muted-foreground">
        Every day the kitchen cooks needs a meal{several ? " in at least one service" : ""}.
      </p>
      {narrow ? (
        <ul className="flex flex-col gap-3" aria-label="Menu by day">
          {days.map((d) => (
            <li key={d} className="flex flex-col gap-2 rounded-lg border p-3">
              <h3 className="font-medium">{dayName(d)}</h3>
              {services.map((sv) => (
                <div key={sv.id} className="flex flex-col gap-1">
                  <span aria-hidden="true" className="text-sm text-muted-foreground">
                    {several ? sv.name : "Meal"}
                  </span>
                  {select(d, sv)}
                </div>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <Table aria-label="Menu by day">
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              {services.map((sv) => (
                <TableHead key={sv.id}>{several ? sv.name : "Meal"}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d}>
                <TableHead scope="row" className="font-medium">
                  {dayName(d)}
                </TableHead>
                {services.map((sv) => (
                  <TableCell key={sv.id}>{select(d, sv)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {words ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-foreground"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {words}
        </div>
      ) : null}
      {services.map((sv) => {
        const served = new Set(Object.values(grid.cells[sv.id] ?? {}));
        const on = new Set(grid.offered[sv.id] ?? []);
        return (
          <GroupField
            key={sv.id}
            label={several ? `Offered in ${sv.name}` : "Also offered"}
            description="The other meals one may switch to, and the add-ons one may ask for. A meal on the grid is always offered."
          >
            {() => (
              <div className="grid gap-2 sm:grid-cols-2">
                {[...meals, ...addOns].map((it) => {
                  const forced = served.has(it.id);
                  return (
                    <CheckRow
                      key={it.id}
                      checked={forced || on.has(it.id)}
                      disabled={forced}
                      onChange={(on2) => setGrid(toggleOffered(grid, sv.id, it.id, on2))}
                      title={it.name}
                    />
                  );
                })}
              </div>
            )}
          </GroupField>
        );
      })}
      <FormField
        name="note"
        label="Note (optional)"
        description={`${note.length} of 500 characters`}
      >
        {(f) => <Input {...f} maxLength={500} autoComplete="off" />}
      </FormField>
    </FormModal>
  );
}

/** One menu as it was set: a table on a wide screen, a day by day list on a phone. */
function MenuView({ menu, working }: { menu: MenuVersion; working: readonly Weekday[] }) {
  const { boot } = useWorkspace();
  const narrow = useIsNarrow();
  const services = inOrder(boot.services).filter((s) => menu.days[s.id] || menu.offered[s.id]);
  const several = boot.services.length >= 2;
  const days = WEEK.filter((d) => working.includes(d));
  const meal = (svId: string, d: Weekday) => {
    const id = menu.days[svId]?.[d];
    return id ? itemName(boot, id) : "Not served";
  };
  return (
    <div className="flex flex-col gap-3">
      {narrow ? (
        <ItemGroup className="gap-2" aria-label={`Menu from ${date(menu.effectiveFrom)}`}>
          {days.map((d) => (
            <Item key={d} variant="outline" size="sm" role="listitem">
              <ItemContent>
                <ItemTitle>{dayName(d)}</ItemTitle>
                {services.map((sv) => (
                  <ItemDescription key={sv.id}>
                    {several ? `${sv.name}: ` : ""}
                    {meal(sv.id, d)}
                  </ItemDescription>
                ))}
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <div className="rounded-xl border">
          <Table aria-label={`Menu from ${date(menu.effectiveFrom)}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                {services.map((sv) => (
                  <TableHead key={sv.id}>{several ? sv.name : "Meal"}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d}>
                  <TableHead scope="row" className="font-medium">
                    {dayName(d)}
                  </TableHead>
                  {services.map((sv) => (
                    <TableCell key={sv.id}>{meal(sv.id, d)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {services.map((sv) => {
        const rest = (menu.offered[sv.id] ?? []).filter(
          (id) => !Object.values(menu.days[sv.id] ?? {}).includes(id),
        );
        return rest.length > 0 ? (
          <p key={sv.id} className="text-sm text-muted-foreground">
            {several ? `${serviceName(boot, sv.id)} also offers: ` : "Also offered: "}
            {rest.map((id) => itemName(boot, id)).join(", ")}.
          </p>
        ) : null;
      })}
      {menu.note ? <p className="text-sm text-muted-foreground">{menu.note}</p> : null}
    </div>
  );
}

/** The menus of a kitchen, newest first. Every kitchen has them, whether or not it tracks money. */
export function MenuTab() {
  const ws = useWorkspace();
  const menus = useLoad(() => getJson<MenuVersion[]>(`${ws.api}/menus`), ws.api);
  const pols = useLoad(
    () => getJson<{ effectiveFrom: string; doc: PolicyView }[]>(`${ws.api}/policies`),
    ws.api,
  );
  const [open, setOpen] = useState(false);
  const list = [...(menus.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const current = pols.data?.length
    ? must(pols.data[pols.data.length - 1]).doc
    : (ws.boot.policy ?? DEFAULT_POLICY);
  const working = current.workingDays as Weekday[];
  const hasMeals =
    offerable(ws.boot, "meal", ws.boot.today).length > 0 &&
    liveOn(ws.boot.services, ws.boot.today).length > 0;
  const [newest, ...older] = list;
  const loading = menus.loading && !menus.data;
  return (
    <div className="flex flex-col gap-4">
      <LoadError
        error={menus.error ?? pols.error}
        onRetry={() => {
          menus.reload();
          pols.reload();
        }}
      />
      <Section
        title="Menus"
        description="What is served on each day the kitchen cooks. A new menu applies from its date onwards."
        actions={
          <Button
            type="button"
            disabled={!ws.writable || !hasMeals || !menus.data}
            onClick={() => setOpen(true)}
          >
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            New menu
          </Button>
        }
      >
        <PageSkeleton loading={loading} variant="table">
          {!hasMeals ? (
            <EmptyState
              title="Add what you serve first"
              description="A menu puts meals on days, so it needs a service and a meal."
              action={
                <Button render={<Link href={`${ws.base}/setup/items`} />} nativeButton={false}>
                  Go to What you serve
                </Button>
              }
            />
          ) : list.length === 0 ? (
            <EmptyState
              title="No menu yet"
              description="Meals are counted from the day a menu starts."
              action={
                <Button type="button" disabled={!ws.writable} onClick={() => setOpen(true)}>
                  New menu
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {newest ? (
                <div className="flex flex-col gap-3">
                  <h3 className="font-medium">From {date(newest.effectiveFrom)}</h3>
                  <MenuView menu={newest} working={working} />
                </div>
              ) : null}
              {older.length > 0 ? (
                <Accordion className="rounded-lg border px-3">
                  {older.map((m) => (
                    <AccordionItem key={m.id} value={m.id}>
                      <AccordionTrigger>Earlier: from {date(m.effectiveFrom)}</AccordionTrigger>
                      <AccordionContent>
                        <MenuView menu={m} working={working} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : null}
            </div>
          )}
        </PageSkeleton>
      </Section>
      {open ? (
        <MenuForm
          last={newest ?? null}
          working={working}
          onClose={() => setOpen(false)}
          onDone={() => {
            menus.reload();
            ws.reload();
          }}
        />
      ) : null}
    </div>
  );
}
