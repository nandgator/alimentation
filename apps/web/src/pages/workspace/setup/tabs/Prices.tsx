import type { MenuVersion, RateCard } from "@alimentation/core";
import { PlusIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { getJson, postJson } from "@/api";
import {
  DateField,
  EmptyState,
  FormField,
  Money,
  MoneyInput,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsNarrow } from "@/hooks/use-media-query";
import { itemName, serviceName } from "../../../../catalogue.ts";
import { date } from "../../../../format.ts";
import {
  earliestRateCard,
  fieldsFrom,
  itemsToPrice,
  type PriceFields,
  priceBody,
  priceProblems,
  servicesOffering,
} from "../../../../priceForm.ts";
import { useWorkspace } from "../../context.tsx";
import { ABOUT_DATE, aboutDate, FormModal, LoadError, Section } from "../parts.tsx";
import { useLoad } from "../use-load.ts";

type Values = PriceFields & { from: string; note: string };

/**
 * New prices from a date, one line for each item the menus offer. Where a kitchen has several services, an item
 * can cost something else in one of them; a kitchen with one never sees that.
 */
function PricesForm({
  last,
  menus,
  onClose,
  onDone,
}: {
  last: RateCard | null;
  menus: readonly MenuVersion[];
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const { boot } = ws;
  const initial = useRef<Values>({ ...fieldsFrom(last), from: boot.today, note: "" });
  // The items to price follow the date, so the schema reads them as they are when the form is checked.
  const itemsNow = useRef<ReturnType<typeof itemsToPrice>>([]);
  const schema = useMemo(
    () =>
      z
        .object({
          from: z.string().min(1, "Choose the date these prices start"),
          // A field nobody typed in is undefined, not empty: it is read as empty.
          base: z.record(
            z.string(),
            z
              .string()
              .optional()
              .transform((t) => t ?? ""),
          ),
          override: z.record(
            z.string(),
            z.record(
              z.string(),
              z
                .string()
                .optional()
                .transform((t) => t ?? ""),
            ),
          ),
          fee: z.string(),
          note: z.string().max(500, "Use 500 characters or fewer"),
        })
        .superRefine((v, ctx) => {
          for (const p of priceProblems(itemsNow.current, v))
            ctx.addIssue({ code: "custom", path: p.path.split("."), message: p.message });
        }),
    [],
  );
  const form = useAppForm(schema, initial.current);
  const from = form.watch("from");
  const note = form.watch("note");
  const items = itemsToPrice(menus, boot.catalogue, from);
  itemsNow.current = items;
  const several =
    boot.services.filter((s) => s.archivedOn === null || s.archivedOn > from).length >= 2;
  return (
    <FormModal
      form={form}
      title="New prices"
      description="Prices are never changed after the fact: new prices apply from their date onwards."
      submitLabel="Add prices"
      busyLabel="Adding…"
      onClose={onClose}
      serverFields={{ [ABOUT_DATE]: "from" }}
      onSubmit={async (v) => {
        const body = priceBody(
          items,
          v,
          (id) => itemName(boot, id),
          (id) => serviceName(boot, id),
        );
        if (!body.ok) throw new Error(body.message);
        try {
          await postJson(`${ws.api}/rate-cards`, {
            effectiveFrom: v.from,
            prices: body.prices,
            monthlyFee: body.monthlyFee,
            note: v.note.trim() || null,
          });
        } catch (e) {
          throw aboutDate(e);
        }
        toast.success(`Prices added from ${date(v.from)}.`);
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
            min={earliestRateCard(boot.policy?.rateCards?.backdating, boot.today) ?? undefined}
            label="Prices apply from"
          />
        )}
      </FormField>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is on the menu yet, so there is nothing to price.
        </p>
      ) : null}
      {items.map((it) => {
        const where = several ? servicesOffering(menus, it.id, from) : [];
        return (
          <div key={it.id} className="flex flex-col gap-2">
            <FormField name={`base.${it.id}`} label={`${it.name}, per ${it.unit}`}>
              {(f) => <MoneyInput {...f} value={f.value ?? ""} />}
            </FormField>
            {where.length > 1 ? (
              <Collapsible>
                <CollapsibleTrigger
                  render={<Button type="button" variant="link" size="sm" className="px-0" />}
                >
                  Different price in a service
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 flex flex-col gap-4 border-l-2 pl-3">
                  {where.map((sv) => (
                    <FormField
                      key={sv}
                      name={`override.${it.id}.${sv}`}
                      label={`${it.name} in ${serviceName(boot, sv)}`}
                      description="Leave empty for the price above."
                    >
                      {(f) => <MoneyInput {...f} value={f.value ?? ""} />}
                    </FormField>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        );
      })}
      <FormField
        name="fee"
        label="Monthly fee"
        description="Charged once a month when the rules say so. Enter 0 for none."
      >
        {(f) => <MoneyInput {...f} />}
      </FormField>
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

/** One rate card: what each item costs, and the monthly fee. */
function CardView({ card }: { card: RateCard }) {
  const { boot } = useWorkspace();
  const narrow = useIsNarrow();
  const several = boot.services.length >= 2;
  const where = (serviceId: string | null) =>
    several ? (serviceId ? serviceName(boot, serviceId) : "Every service") : null;
  return (
    <div className="flex flex-col gap-3">
      {narrow ? (
        <ItemGroup className="gap-2" aria-label={`Prices from ${date(card.effectiveFrom)}`}>
          {card.prices.map((l) => (
            <Item key={`${l.itemId}-${l.serviceId}`} variant="outline" size="sm" role="listitem">
              <ItemContent>
                <ItemTitle>{itemName(boot, l.itemId)}</ItemTitle>
                {where(l.serviceId) ? (
                  <ItemDescription>{where(l.serviceId)}</ItemDescription>
                ) : null}
              </ItemContent>
              <Money paise={l.amount} fraction />
            </Item>
          ))}
          <Item variant="outline" size="sm" role="listitem">
            <ItemContent>
              <ItemTitle>Monthly fee</ItemTitle>
            </ItemContent>
            <Money paise={card.monthlyFee} fraction />
          </Item>
        </ItemGroup>
      ) : (
        <div className="rounded-xl border">
          <Table aria-label={`Prices from ${date(card.effectiveFrom)}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                {several ? <TableHead>In</TableHead> : null}
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.prices.map((l) => (
                <TableRow key={`${l.itemId}-${l.serviceId}`}>
                  <TableCell>{itemName(boot, l.itemId)}</TableCell>
                  {several ? <TableCell>{where(l.serviceId)}</TableCell> : null}
                  <TableCell className="text-right">
                    <Money paise={l.amount} fraction />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Monthly fee</TableCell>
                {several ? <TableCell /> : null}
                <TableCell className="text-right">
                  <Money paise={card.monthlyFee} fraction />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      {card.note ? <p className="text-sm text-muted-foreground">{card.note}</p> : null}
    </div>
  );
}

/** The prices of a kitchen that tracks money, newest first. */
export function PricesTab() {
  const ws = useWorkspace();
  const cards = useLoad(() => getJson<RateCard[]>(`${ws.api}/rate-cards`), ws.api);
  const menus = useLoad(() => getJson<MenuVersion[]>(`${ws.api}/menus`), ws.api);
  const [open, setOpen] = useState(false);
  const list = [...(cards.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const [newest, ...older] = list;
  return (
    <div className="flex flex-col gap-4">
      <LoadError
        error={cards.error ?? menus.error}
        onRetry={() => {
          cards.reload();
          menus.reload();
        }}
      />
      <Section
        title="Rate cards"
        description="What each meal and extra costs. What is served is on the menu."
        actions={
          <Button
            type="button"
            disabled={!ws.writable || !menus.data}
            onClick={() => setOpen(true)}
          >
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            New prices
          </Button>
        }
      >
        <PageSkeleton loading={cards.loading && !cards.data} variant="table">
          {list.length === 0 ? (
            <EmptyState
              title="No prices yet"
              description="Add prices to start billing. The menu says which items need one."
              action={
                menus.data && menus.data.length === 0 ? (
                  <Button render={<Link href={`${ws.base}/setup/menu`} />} nativeButton={false}>
                    Go to Menu
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={!ws.writable || !menus.data}
                    onClick={() => setOpen(true)}
                  >
                    New prices
                  </Button>
                )
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {newest ? (
                <div className="flex flex-col gap-3">
                  <h3 className="font-medium">From {date(newest.effectiveFrom)}</h3>
                  <CardView card={newest} />
                </div>
              ) : null}
              {older.length > 0 ? (
                <Accordion className="rounded-lg border px-3">
                  {older.map((c) => (
                    <AccordionItem key={c.id} value={c.id}>
                      <AccordionTrigger>Earlier: from {date(c.effectiveFrom)}</AccordionTrigger>
                      <AccordionContent>
                        <CardView card={c} />
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
        <PricesForm
          last={newest ?? null}
          menus={menus.data ?? []}
          onClose={() => setOpen(false)}
          onDone={() => {
            cards.reload();
            ws.reload();
          }}
        />
      ) : null}
    </div>
  );
}
