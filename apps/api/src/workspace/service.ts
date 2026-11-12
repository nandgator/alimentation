import {
  type AuditRow,
  type BootstrapDto,
  buildMealStatements,
  buildStatements,
  type CatalogueItemDto,
  type ClaimDto,
  checkCatalogueItem,
  checkClaim,
  checkClaimWithdrawal,
  checkDecision,
  checkEnrolment,
  checkExternalKey,
  checkLogChange,
  checkLogEntry,
  checkMenu,
  checkPersonFields,
  checkRateCard,
  checkReversal,
  checkService,
  closeSnapshot,
  meter as computeMeter,
  consumers,
  DEFAULT_POLICY,
  describeAudit,
  type EngineData,
  EngineError,
  type ExistingPerson,
  expandHolidayItem,
  expandHolidayItems,
  type HistoryContext,
  type HistoryEventDto,
  type HolidayDay,
  type HolidayImportAction,
  type HolidayImportItem,
  type HolidayImportMode,
  type HolidayImportResult,
  type HolidayImportRow,
  hasErrors,
  headline,
  holidayKey,
  type Issue,
  isValidDate,
  isValidMonth,
  type KitchenTotals,
  type LedgerDto,
  type Limits,
  type LogAction,
  type LogEntryDto,
  lateByDays,
  ledgerMonth,
  localNow,
  MAX_HOLIDAY_ROWS,
  MAX_PEOPLE_IMPORT_ROWS,
  type MealStatementDto,
  type MenuVersion,
  type Month,
  mealLedgerRow,
  monthEnd,
  monthOf,
  monthRange,
  monthStart,
  must,
  type PayMethod,
  type PersonDto,
  type PersonImportItem,
  type PersonImportMode,
  type PersonImportResult,
  type PersonImportRow,
  type Policy,
  PolicySchema,
  type PolicyView,
  type Prepared,
  type PriceLine,
  parseHolidayCsv,
  parsePeopleCsv,
  planPeopleImport,
  policyForMonth,
  policyView,
  prepare,
  type RateCard,
  type Role,
  type RowProblem,
  type Service,
  type SettlementDto,
  type SettlementType,
  STATUS_LABEL,
  type StatementDto,
  type Usage,
  whoLabel,
  withoutMoneyRules,
} from "@alimentation/core";
import type { FieldCipher } from "../crypto/fields.ts";
import type { Db, Tx } from "../db/driver.ts";
import { type Actor, asActor } from "./context.ts";
import { ApiError, forbidden, invalid, mapDbError, notFound } from "./errors.ts";
import { setupHints } from "./hints.ts";
import {
  applyAutoCloses,
  loadCatalogue,
  loadEngineData,
  loadMenus,
  loadRateCards,
  loadServices,
  withDueCloses,
} from "./load.ts";

// biome-ignore lint/suspicious/noExplicitAny: rows come back from the driver as untyped JSON
type R = Record<string, any>;

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  currency: string;
  /** Whether the kitchen tracks money. Fixed when it was made, so it is read once and kept. */
  moneyEnabled: boolean;
  state: "ACTIVE" | "MIGRATING" | "MOVED";
  movedTo: string | null;
  limits: Limits;
  overSince: string | null;
}

export interface ServiceDeps {
  db: Db;
  cipher: FieldCipher;
  info: WorkspaceInfo;
  now: () => Date;
  /** Requests this workspace made in the last day, from the platform's counters. */
  requestsLast24h: () => Promise<number>;
  /** Records the date the workspace first went over a cap, or clears it. */
  recordOverSince: (date: string | null) => Promise<void>;
}

/**
 * Who the books are read as when a head office asks how the kitchen is doing: an admin who is no one in
 * particular, so that every row can be counted and none of them can be pointed at. It is never given a way to
 * write (see `totals`), and what is made from the rows leaves as numbers.
 */
const NO_ONE: Actor = { role: "admin", personId: "00000000-0000-0000-0000-000000000000" };

/** The money rules at their neutral values, for a policy document to be filled in with. */
const DEFAULT_MONEY = (({ monthlyFee, leave, payments, rateCards }) => ({
  monthlyFee,
  leave,
  payments,
  rateCards,
}))(DEFAULT_POLICY);

/** SHA-256 of some text, as lower-case hex. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a route about money answers in a kitchen that does not track it. */
export const noMoney = () =>
  new ApiError(404, "money_not_tracked", "This kitchen does not track money.");

function requireOk(issues: Issue[]): Issue[] {
  if (hasErrors(issues)) {
    const first = must(issues.find((i) => i.severity === "error"));
    throw invalid(first.message, issues);
  }
  return issues.filter((i) => i.severity === "warning");
}

/**
 * Everything a signed-in person can do inside one workspace. Reads go through the
 * caller's row-level security; writes are checked by the rules in `@alimentation/core`
 * first (for a helpful message) and by the database after (for the guarantee).
 */
export class WorkspaceService {
  constructor(private readonly d: ServiceDeps) {}

  private get tz() {
    return this.d.info.timeZone;
  }
  private local() {
    return localNow(this.d.now(), this.tz);
  }

  private async run<T>(
    actor: Actor | null,
    fn: (tx: Tx, data: () => Promise<EngineData>) => Promise<T>,
  ): Promise<T> {
    try {
      return await asActor(this.d.db, actor, async (tx) => {
        let cached: EngineData | undefined;
        const data = async () =>
          (cached ??= await applyAutoCloses(
            tx,
            await loadEngineData(tx, this.d.cipher, this.local().date),
          ));
        return fn(tx, data);
      });
    } catch (e) {
      throw mapDbError(e);
    }
  }

  /** For what only a kitchen with money has: prices, claims, settlements. */
  private requireMoney(): void {
    if (!this.d.info.moneyEnabled) throw noMoney();
  }

  private assertWritable(): void {
    if (this.d.info.state !== "ACTIVE") {
      throw new ApiError(
        409,
        "read_only",
        this.d.info.state === "MOVED"
          ? "This workspace has moved."
          : "This workspace is being moved and is read-only.",
      );
    }
  }

  // --- reading -----------------------------------------------------------

  async bootstrap(actor: Actor, roles: Role[]): Promise<Omit<BootstrapDto, "organisation">> {
    const info = this.d.info;
    const requests = actor.role === "admin" ? await this.d.requestsLast24h() : 0;
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const p = prepare(data);
      const today = data.today;
      const current = monthOf(today);
      const me = data.people.find((x) => x.id === actor.personId);

      const money = info.moneyEnabled;
      const setup: BootstrapDto["setup"] = setupHints(data, money);

      let statements: BootstrapDto["statements"] = [];
      const ids = consumers(p).map((c) => c.id);
      if (data.menus.length > 0) {
        try {
          if (!money) statements = this.mealDto(buildMealStatements(p, ids, [current]), data);
          else if (data.rateCards.length > 0)
            statements = this.dto(buildStatements(p, ids, [current]), data);
          else statements = this.mealDto(buildMealStatements(p, ids, [current]), data);
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          // An item with no price is already named by the hint that asks for prices.
          if (!(e.code === "NO_PRICE" && setup.some((h) => h.code === "rate_card")))
            setup.push({ code: e.code.toLowerCase(), message: e.message });
        }
      }

      const pending = money
        ? (
            await tx.query<R>(
              `SELECT count(*)::int AS n FROM claim c WHERE NOT EXISTS (SELECT 1 FROM claim_decision d WHERE d.claim_id = c.id)`,
            )
          )[0]
        : undefined;

      let meterOut: BootstrapDto["meter"] = null;
      if (actor.role === "admin") {
        const usage = await this.measure(tx, requests);
        const m = computeMeter(usage, info.limits, info.overSince, today);
        if (m.overSince !== info.overSince) await this.d.recordOverSince(m.overSince);
        meterOut = { ...m, usage };
      }

      const newestFirst = <T extends { effectiveFrom: string }>(list: readonly T[]) =>
        [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
      const menu = newestFirst(data.menus).find((m) => m.effectiveFrom <= today) ?? null;
      const rateCard = money
        ? (newestFirst(data.rateCards).find((c) => c.effectiveFrom <= today) ?? null)
        : undefined;
      return {
        workspace: {
          id: info.id,
          slug: info.slug,
          name: info.name,
          timeZone: info.timeZone,
          currency: info.currency,
          moneyEnabled: money,
          state: info.state,
          movedTo: info.movedTo,
        },
        me: { personId: actor.personId, role: actor.role, name: me?.name ?? "" },
        roles,
        today,
        currentMonth: current,
        months: monthRange(p),
        policy: policyView(policyForMonth(data.policies, current), money),
        catalogue: [...data.catalogue],
        services: [...data.services],
        enrolments: [...data.enrolments],
        menu,
        ...(rateCard !== undefined ? { rateCard } : {}),
        holidays: [...data.holidays],
        people: await this.peopleDtos(tx, actor, data),
        statements,
        setup,
        ...(money ? { pendingClaims: pending?.n ?? 0 } : {}),
        meter: meterOut,
        workspaceState: info.state,
        movedTo: info.movedTo,
      };
    });
  }

  /**
   * What a head office may know of this kitchen for the month: counts and money, and nothing about anyone.
   * It is read in a read-only transaction, as no one in particular, from books worked out in memory and
   * thrown away. Nothing is stored, not even the closes that have fallen due: the kitchen's own next visit
   * stores those, and they are counted here as they will stand.
   */
  async totals(): Promise<KitchenTotals> {
    try {
      return await asActor(this.d.db, NO_ONE, async (tx) => {
        await tx.query("SET TRANSACTION READ ONLY");
        const { data } = withDueCloses(await loadEngineData(tx, this.d.cipher, this.local().date));
        const p = prepare(data);
        const current = monthOf(data.today);
        const ids = consumers(p).map((c) => c.id);
        const money = this.d.info.moneyEnabled;
        const hints = setupHints(data, money);
        let setup = hints.length;
        const counts = { month: current, consumers: ids.length };
        if (!money) {
          let meals = 0;
          if (data.menus.length > 0) {
            try {
              meals = buildMealStatements(p, ids, [current]).reduce(
                (a, x) => a + x.counts.meals,
                0,
              );
            } catch (e) {
              if (!(e instanceof EngineError)) throw e;
              setup++;
            }
          }
          return { ...counts, meals, setup, moneyEnabled: false as const };
        }
        let statements: ReturnType<typeof buildStatements> = [];
        if (data.menus.length > 0 && data.rateCards.length > 0) {
          try {
            statements = buildStatements(p, ids, [current]);
          } catch (e) {
            if (!(e instanceof EngineError)) throw e;
            if (!(e.code === "NO_PRICE" && hints.some((h) => h.code === "rate_card"))) setup++;
          }
        }
        const [pending] = await tx.query<R>(
          `SELECT count(*)::int AS n FROM claim c WHERE NOT EXISTS (SELECT 1 FROM claim_decision d WHERE d.claim_id = c.id)`,
        );
        const h = headline(statements, pending?.n ?? 0);
        return {
          ...counts,
          moneyEnabled: true as const,
          currency: this.d.info.currency,
          meals: statements.reduce((a, x) => a + x.counts.meals, 0),
          billed: h.billed,
          paid: h.paid,
          owed: h.owed,
          toConfirm: h.toConfirm,
          setup,
        };
      });
    } catch (e) {
      throw mapDbError(e);
    }
  }

  private async measure(tx: Tx, requests: number): Promise<Usage> {
    const [row] = await tx.query<R>(
      `SELECT (SELECT count(*) FROM person)::int AS people,
              ((SELECT count(*) FROM log_entry) + (SELECT count(*) FROM claim) + (SELECT count(*) FROM settlement) + (SELECT count(*) FROM claim_decision))::int AS rows,
              -- Our own tables and their indexes: an empty Postgres database is already several
              -- megabytes of catalogs, which are not the kitchen's, and on a database the tenant owns
              -- the rest of it is not ours to count.
              (SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm'))::bigint AS bytes`,
    );
    return {
      requestsLast24h: requests,
      people: must(row).people,
      rows: must(row).rows,
      bytes: Number(must(row).bytes),
    };
  }

  private dto(statements: ReturnType<typeof buildStatements>, data: EngineData): StatementDto[] {
    const names = new Map(data.people.map((x) => [x.id, x.name]));
    return statements.map((s) => ({
      ...s,
      name: names.get(s.personId) ?? "",
      label: STATUS_LABEL[s.status],
    }));
  }

  private mealDto(
    statements: ReturnType<typeof buildMealStatements>,
    data: EngineData,
  ): MealStatementDto[] {
    const names = new Map(data.people.map((x) => [x.id, x.name]));
    return statements.map((s) => ({ ...s, name: names.get(s.personId) ?? "" }));
  }

  private async peopleDtos(tx: Tx, actor: Actor, data: EngineData): Promise<PersonDto[]> {
    const rows = await tx.query<R>(
      "SELECT id, status, contact_enc, external_key, (account_id IS NOT NULL) AS linked FROM person",
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: PersonDto[] = [];
    for (const person of data.people) {
      const r = byId.get(person.id);
      if (!r) continue;
      out.push({
        id: person.id,
        name: person.name,
        role: person.role,
        status: r.status,
        activeFrom: person.activeFrom,
        activeTo: person.activeTo,
        contact:
          actor.role === "admin"
            ? await this.d.cipher.dec("person", "contact_enc", person.id, r.contact_enc)
            : null,
        linked: r.linked,
        externalKey: actor.role === "admin" ? (r.external_key ?? null) : null,
      });
    }
    return out;
  }

  async statements(
    actor: Actor,
    months: Month[],
    personId?: string,
  ): Promise<(StatementDto | MealStatementDto)[]> {
    for (const m of months) if (!isValidMonth(m)) throw invalid(`"${m}" is not a month`);
    if (months.length > 36) throw invalid("Ask for at most 36 months at a time.");
    return this.run(actor, async (_tx, load) => {
      const data = await load();
      const p = prepare(data);
      const ids = personId ? [personId] : consumers(p).map((c) => c.id);
      if (personId && !data.people.some((x) => x.id === personId)) throw notFound("Person");
      try {
        return this.d.info.moneyEnabled
          ? this.dto(buildStatements(p, ids, months), data)
          : this.mealDto(buildMealStatements(p, ids, months), data);
      } catch (e) {
        if (e instanceof EngineError) throw new ApiError(422, e.code.toLowerCase(), e.message);
        throw e;
      }
    });
  }

  async ledger(actor: Actor, month: Month, personId: string): Promise<LedgerDto> {
    if (!isValidMonth(month)) throw invalid(`"${month}" is not a month`);
    return this.run(actor, async (_tx, load) => {
      const data = await load();
      const person = data.people.find((x) => x.id === personId && x.role === "consumer");
      if (!person) throw notFound("Person");
      try {
        const rows = ledgerMonth(prepare(data), person, month);
        return {
          personId,
          month,
          rows: this.d.info.moneyEnabled ? rows : rows.map(mealLedgerRow),
        };
      } catch (e) {
        if (e instanceof EngineError) throw new ApiError(422, e.code.toLowerCase(), e.message);
        throw e;
      }
    });
  }

  // --- people ------------------------------------------------------------

  async createPerson(
    actor: Actor,
    input: {
      name: string;
      role: Role;
      contact?: string | null;
      activeFrom?: string | null;
      activeTo?: string | null;
      externalKey?: string | null;
    },
  ): Promise<{ id: string }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const name = input.name.trim();
    const bad = checkPersonFields({ ...input, name });
    if (bad) throw invalid(bad);
    const key = input.externalKey?.trim() || null;
    const badKey = key ? checkExternalKey(key) : null;
    if (badKey) throw invalid(badKey);
    const id = crypto.randomUUID();
    return this.run(actor, async (tx) => {
      if (key) await this.mustBeFreeKey(tx, key);
      await tx.query(
        `INSERT INTO person (id, role, name_enc, contact_enc, external_key, active_from, active_to) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.role,
          await this.d.cipher.enc("person", "name_enc", id, name),
          await this.d.cipher.enc("person", "contact_enc", id, input.contact?.trim() || null),
          key,
          input.activeFrom ?? null,
          input.activeTo ?? null,
        ],
      );
      // A new member takes every service the kitchen has, from the day they are first billed.
      if (input.role === "consumer" && input.activeFrom) await this.enrol(tx, id, input.activeFrom);
      return { id };
    });
  }

  /** Puts a member into some services (all the kitchen's live ones if none are named) from a date. */
  private async enrol(
    tx: Tx,
    personId: string,
    from: string,
    serviceIds?: string[],
  ): Promise<void> {
    const ids =
      serviceIds ??
      (
        await tx.query<R>("SELECT id FROM service WHERE archived_on IS NULL ORDER BY position, id")
      ).map((r) => r.id as string);
    for (const serviceId of ids)
      await tx.query(
        "INSERT INTO person_service (person_id, service_id, active_from) VALUES ($1, $2, $3)",
        [personId, serviceId, from],
      );
  }

  /**
   * Makes a member take exactly these services from `from` on: a service they take that is not named ends the
   * day before, one named that they do not take starts. What came before `from` is not touched, so a month
   * that is closed stays as it was.
   */
  private async takeServicesFrom(
    tx: Tx,
    personId: string,
    serviceIds: ReadonlySet<string>,
    from: string,
  ): Promise<void> {
    const rows = await tx.query<R>(
      `SELECT id, service_id, active_from, active_to FROM person_service
        WHERE person_id = $1 AND (active_to IS NULL OR active_to >= $2) ORDER BY active_from`,
      [personId, from],
    );
    const covered = new Set<string>();
    for (const r of rows) {
      const wanted = serviceIds.has(r.service_id);
      if (!wanted) {
        if (r.active_from >= from)
          await tx.query("DELETE FROM person_service WHERE id = $1", [r.id]);
        else
          await tx.query("UPDATE person_service SET active_to = ($2::date - 1) WHERE id = $1", [
            r.id,
            from,
          ]);
      } else if (r.active_from <= from) covered.add(r.service_id);
      else if (!covered.has(r.service_id)) {
        await tx.query("UPDATE person_service SET active_from = $2 WHERE id = $1", [r.id, from]);
        covered.add(r.service_id);
      }
    }
    for (const serviceId of serviceIds)
      if (!covered.has(serviceId)) await this.enrol(tx, personId, from, [serviceId]);
  }

  /**
   * A member whose first day moves earlier takes, from the new day, what they took on the old one: a service
   * that began with them begins with the new day, or the days added would be billed as nothing.
   */
  private async reachBack(tx: Tx, personId: string, was: string, now: string): Promise<void> {
    if (now >= was) return;
    await tx.query(
      "UPDATE person_service SET active_from = $3 WHERE person_id = $1 AND active_from = $2",
      [personId, was, now],
    );
  }

  private async mustBeFreeKey(tx: Tx, key: string): Promise<void> {
    const taken = await tx.query<R>("SELECT 1 FROM person WHERE external_key = $1", [key]);
    if (taken.length > 0)
      throw new ApiError(409, "conflict", "Another person already has that key.");
  }

  async updatePerson(
    actor: Actor,
    id: string,
    input: {
      name?: string;
      contact?: string | null;
      activeFrom?: string | null;
      activeTo?: string | null;
      status?: "ACTIVE" | "DISABLED";
      externalKey?: string | null;
    },
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx) => {
      const [row] = await tx.query<R>("SELECT role, external_key FROM person WHERE id = $1", [id]);
      if (!row) throw notFound("Person");
      const sets: string[] = [];
      const values: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        values.push(v);
        sets.push(`${col} = $${values.length}`);
      };
      if (input.name !== undefined) {
        const n = input.name.trim();
        if (!n || n.length > 120) throw invalid("Give a name of up to 120 characters.");
        set("name_enc", await this.d.cipher.enc("person", "name_enc", id, n));
      }
      if (input.contact !== undefined)
        set(
          "contact_enc",
          await this.d.cipher.enc("person", "contact_enc", id, input.contact?.trim() || null),
        );
      for (const [key, col] of [
        ["activeFrom", "active_from"],
        ["activeTo", "active_to"],
      ] as const) {
        const v = input[key];
        if (v === undefined) continue;
        if (v !== null && !isValidDate(v)) throw invalid(`"${v}" is not a date`);
        set(col, v);
      }
      if (input.status !== undefined) set("status", input.status);
      if (input.externalKey !== undefined) {
        // Given as it already is, it is no change. Otherwise it can be set once, on a person who has none.
        const want = input.externalKey?.trim() || null;
        const has = (row.external_key as string | null) ?? null;
        if (want !== has) {
          if (has !== null || want === null)
            throw new ApiError(
              409,
              "immutable",
              "A person’s key cannot be changed once it is set.",
            );
          const badKey = checkExternalKey(want);
          if (badKey) throw invalid(badKey);
          await this.mustBeFreeKey(tx, want);
          set("external_key", want);
        }
      }
      if (sets.length === 0) return;
      const before = await tx.query<R>("SELECT active_from FROM person WHERE id = $1", [id]);
      await tx.query(`UPDATE person SET ${sets.join(", ")} WHERE id = $1`, values);
      // A member who is first given a day to be billed from starts by taking every service.
      if (row.role === "consumer" && input.activeFrom && before[0]?.active_from == null) {
        const [has] = await tx.query<R>("SELECT 1 AS x FROM person_service WHERE person_id = $1", [
          id,
        ]);
        if (!has) await this.enrol(tx, id, input.activeFrom);
      } else if (row.role === "consumer" && input.activeFrom && before[0]?.active_from) {
        await this.reachBack(tx, id, before[0].active_from as string, input.activeFrom);
      }
    });
  }

  /**
   * Many people at once, from rows or from `csv` text (see `parsePeopleCsv`). A row with an `externalKey`
   * finds the person who has it and changes them, or adds a new person if nobody does; a row without one
   * adds a person. `merge` sets what a row gives and leaves a blank cell alone; `overwrite` sets everything a
   * row gives, a blank cell clearing the contact or the dates. Nobody is removed or disabled for being
   * absent, and a role is never changed. Either every row is applied in one transaction or none is: one
   * refused row, or more new people than the kitchen's limit leaves room for, writes nothing. A dry run
   * does the same work and writes nothing.
   */
  async importPeople(
    actor: Actor,
    input: {
      mode: PersonImportMode;
      dryRun: boolean;
      rows?: PersonImportItem[];
      csv?: string;
    },
  ): Promise<PersonImportResult> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const parsed =
      input.csv !== undefined
        ? parsePeopleCsv(input.csv)
        : {
            items: (input.rows ?? []).map((item, i) => ({ row: i + 1, item })),
            problems: [] as RowProblem[],
          };
    const given = parsed.items.length + parsed.problems.length;
    if (given === 0) throw invalid("There is nothing to import.");
    if (given > MAX_PEOPLE_IMPORT_ROWS)
      throw invalid(`At most ${MAX_PEOPLE_IMPORT_ROWS} people can be imported at a time.`);
    const fileHash = await sha256Hex(input.csv ?? JSON.stringify(input.rows ?? []));
    const refused: PersonImportRow[] = parsed.problems.map((p) => ({
      row: p.row,
      action: "error",
      externalKey: null,
      name: "",
      id: null,
      diff: [],
      message: p.message,
    }));

    const out = await this.run(actor, async (tx) => {
      const keys = [
        ...new Set(parsed.items.map((e) => (e.item.externalKey ?? "").trim()).filter(Boolean)),
      ];
      const existing = new Map<string, ExistingPerson>();
      const today = this.local().date;
      const takes = new Map<string, string[]>();
      if (keys.length > 0)
        for (const t of await tx.query<R>(
          `SELECT ps.person_id, s.name FROM person_service ps
             JOIN service s ON s.id = ps.service_id
             JOIN person p ON p.id = ps.person_id
            WHERE p.external_key = ANY($1::text[]) AND ps.active_from <= $2
              AND (ps.active_to IS NULL OR ps.active_to >= $2) ORDER BY s.position, s.id`,
          [keys, today],
        ))
          takes.set(t.person_id, [...(takes.get(t.person_id) ?? []), t.name]);
      const serviceRows = await tx.query<R>(
        "SELECT id, name FROM service WHERE archived_on IS NULL ORDER BY position, id",
      );
      if (keys.length > 0)
        for (const r of await tx.query<R>(
          "SELECT id, external_key, role, name_enc, contact_enc, active_from, active_to FROM person WHERE external_key = ANY($1::text[])",
          [keys],
        ))
          existing.set(r.external_key, {
            services: takes.get(r.id) ?? [],
            id: r.id,
            externalKey: r.external_key,
            role: r.role,
            name: must(await this.d.cipher.dec("person", "name_enc", r.id, r.name_enc)),
            contact: await this.d.cipher.dec("person", "contact_enc", r.id, r.contact_enc),
            activeFrom: r.active_from ?? null,
            activeTo: r.active_to ?? null,
          });
      const plan = planPeopleImport(
        parsed.items,
        input.mode,
        existing,
        serviceRows.map((x) => x.name as string),
      );
      const serviceId = (name: string) =>
        must(serviceRows.find((x) => (x.name as string).toLowerCase() === name.toLowerCase()))
          .id as string;

      // The cap is counted before anything is written, so the answer is this sentence and not the database's refusal.
      if (plan.creates.length > 0) {
        const [c] = await tx.query<R>(
          "SELECT (SELECT people_cap FROM workspace) AS cap, (SELECT count(*) FROM person)::int AS n",
        );
        const cap = must(c).cap as number | null;
        const room = cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - must(c).n);
        if (plan.creates.length > room)
          throw new ApiError(
            409,
            "quota_exceeded",
            `This file would add ${plan.creates.length} people, and this kitchen has room for ${room} more (its limit is ${cap}). Nothing was changed.`,
          );
      }

      const rows = [...refused, ...plan.rows].sort((a, b) => a.row - b.row);
      const commit = !input.dryRun && !rows.some((r) => r.action === "error");
      const changed = plan.creates.length + plan.updates.length;
      if (commit && changed > 0) {
        for (const n of plan.creates) {
          const id = crypto.randomUUID();
          await tx.query(
            `INSERT INTO person (id, role, name_enc, contact_enc, external_key, active_from, active_to) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              n.role,
              await this.d.cipher.enc("person", "name_enc", id, n.name),
              await this.d.cipher.enc("person", "contact_enc", id, n.contact),
              n.externalKey,
              n.activeFrom,
              n.activeTo,
            ],
          );
          n.result.id = id;
          if (n.role === "consumer" && n.activeFrom)
            await this.enrol(tx, id, n.activeFrom, n.services?.map(serviceId));
        }
        for (const u of plan.updates) {
          const sets: string[] = [];
          const values: unknown[] = [u.id];
          const set = (col: string, v: unknown) => {
            values.push(v);
            sets.push(`${col} = $${values.length}`);
          };
          if (u.sets.name !== undefined)
            set("name_enc", await this.d.cipher.enc("person", "name_enc", u.id, u.sets.name));
          if (u.sets.contact !== undefined)
            set(
              "contact_enc",
              await this.d.cipher.enc("person", "contact_enc", u.id, u.sets.contact),
            );
          if (u.sets.activeFrom !== undefined) set("active_from", u.sets.activeFrom);
          if (u.sets.activeTo !== undefined) set("active_to", u.sets.activeTo);
          const [was] = await tx.query<R>("SELECT role, active_from FROM person WHERE id = $1", [
            u.id,
          ]);
          if (sets.length > 0)
            await tx.query(`UPDATE person SET ${sets.join(", ")} WHERE id = $1`, values);
          if (was?.role === "consumer" && was.active_from && typeof u.sets.activeFrom === "string")
            await this.reachBack(tx, u.id, was.active_from as string, u.sets.activeFrom);
          if (u.services) {
            const [p] = await tx.query<R>("SELECT active_from FROM person WHERE id = $1", [u.id]);
            const first = (p?.active_from as string | null) ?? today;
            await this.takeServicesFrom(
              tx,
              u.id,
              new Set(u.services.map(serviceId)),
              first > today ? first : today,
            );
          }
        }
        const count = (a: PersonImportRow["action"]) => rows.filter((r) => r.action === a).length;
        await tx.query("SELECT record_person_import($1::jsonb)", [
          JSON.stringify({
            mode: input.mode,
            fileHash,
            source: input.csv !== undefined ? "csv" : "rows",
            rows: rows.length,
            create: count("create"),
            update: count("update"),
            unchanged: count("unchanged"),
          }),
        ]);
      }
      return { rows, commit };
    });

    const count = (a: PersonImportRow["action"]) => out.rows.filter((r) => r.action === a).length;
    return {
      mode: input.mode,
      dryRun: input.dryRun,
      committed: out.commit,
      fileHash,
      rows: out.rows,
      summary: {
        create: count("create"),
        update: count("update"),
        unchanged: count("unchanged"),
        error: count("error"),
      },
    };
  }

  /** The role of a person, for the admin deciding what to invite them as. */
  async roleOf(actor: Actor, personId: string): Promise<Role> {
    this.mustBeAdmin(actor);
    return this.run(actor, async (tx) => {
      const [row] = await tx.query<R>("SELECT role FROM person WHERE id = $1", [personId]);
      if (!row) throw notFound("Person");
      return row.role as Role;
    });
  }

  private mustBeAdmin(actor: Actor): void {
    if (actor.role !== "admin") throw forbidden("Only the admin can do that.");
  }

  // --- prices, rules, holidays -------------------------------------------

  // --- what the kitchen serves ---------------------------------------------

  /** Everything the kitchen has ever served, retired items included so that history can name them. */
  async listCatalogue(actor: Actor): Promise<CatalogueItemDto[]> {
    return this.run(actor, async (tx) => {
      const items = await loadCatalogue(tx);
      if (!this.d.info.moneyEnabled) return items;
      // The prices in force today. A kitchen without money never reads them.
      const today = this.local().date;
      const card = (await loadRateCards(tx)).filter((c) => c.effectiveFrom <= today).at(-1);
      return items.map((it) => ({
        ...it,
        prices: (card?.prices ?? [])
          .filter((l) => l.itemId === it.id)
          .map((l) => ({ serviceId: l.serviceId, amount: l.amount })),
      }));
    });
  }

  async addItem(
    actor: Actor,
    input: { kind: string; name: string; unit: string; maxQty: number },
  ): Promise<{ id: string }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const item = { ...input, name: input.name.trim(), unit: input.unit.trim() };
    return this.run(actor, async (tx, load) => {
      requireOk(checkCatalogueItem(prepare(await load()), actor, { id: null, ...item }));
      // The database chooses the id (time-ordered), so that the catalogue lists items in the order they were added.
      const [made] = await tx.query<R>(
        `INSERT INTO catalogue_item (kind, name, unit, max_qty, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [item.kind, item.name, item.unit, item.maxQty, actor.personId],
      );
      return { id: must(made).id as string };
    });
  }

  /** Renames an item, or retires it from a date (once): `archived` alone means from today. */
  async updateItem(
    actor: Actor,
    id: string,
    input: { name?: string; archived?: true; archiveOn?: string },
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const name = input.name?.trim();
    const archiveOn = input.archiveOn ?? (input.archived ? this.local().date : undefined);
    await this.run(actor, async (tx, load) => {
      requireOk(
        checkCatalogueItem(prepare(await load()), actor, {
          id,
          ...(name !== undefined ? { name } : {}),
          ...(archiveOn !== undefined ? { archiveOn } : {}),
        }),
      );
      await tx.query(
        "UPDATE catalogue_item SET name = coalesce($2, name), archived_on = coalesce($3::date, archived_on) WHERE id = $1",
        [id, name ?? null, archiveOn ?? null],
      );
    });
  }

  async listServices(actor: Actor): Promise<Service[]> {
    return this.run(actor, (tx) => loadServices(tx));
  }

  /** A new service. Members already in the kitchen take it from the first of this month (or when they began). */
  async addService(actor: Actor, input: { name: string }): Promise<{ id: string }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const name = input.name.trim();
    return this.run(actor, async (tx, load) => {
      const data = await load();
      requireOk(checkService(prepare(data), actor, { id: null, name }));
      const [made] = await tx.query<R>(
        `INSERT INTO service (name, position, created_by)
         VALUES ($1, (SELECT coalesce(max(position) + 1, 0) FROM service), $2) RETURNING id`,
        [name, actor.personId],
      );
      const id = must(made).id as string;
      const first = monthStart(monthOf(data.today));
      for (const p of data.people) {
        if (p.role !== "consumer" || p.activeFrom === null) continue;
        const from = p.activeFrom > first ? p.activeFrom : first;
        if (p.activeTo !== null && p.activeTo < from) continue;
        await this.enrol(tx, p.id, from, [id]);
      }
      return { id };
    });
  }

  /** Renames a service, or retires it from a date (once): `archived` alone means from today. */
  async updateService(
    actor: Actor,
    id: string,
    input: { name?: string; archived?: true; archiveOn?: string },
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const name = input.name?.trim();
    const archiveOn = input.archiveOn ?? (input.archived ? this.local().date : undefined);
    await this.run(actor, async (tx, load) => {
      requireOk(
        checkService(prepare(await load()), actor, {
          id,
          ...(name !== undefined ? { name } : {}),
          ...(archiveOn !== undefined ? { archiveOn } : {}),
        }),
      );
      await tx.query(
        "UPDATE service SET name = coalesce($2, name), archived_on = coalesce($3::date, archived_on) WHERE id = $1",
        [id, name ?? null, archiveOn ?? null],
      );
    });
  }

  /**
   * Replaces the services a member takes. A row left as it was is not touched, so a closed month it reaches
   * does not refuse the change; a row that ends or starts is judged by the closed-month rule from the day it
   * changes.
   */
  async setEnrolments(
    actor: Actor,
    personId: string,
    rows: { serviceId: string; activeFrom: string; activeTo: string | null }[],
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx, load) => {
      requireOk(checkEnrolment(prepare(await load()), actor, personId, rows));
      const old = await tx.query<R>(
        "SELECT id, service_id, active_from, active_to FROM person_service WHERE person_id = $1",
        [personId],
      );
      const key = (s: string, f: string) => `${s}|${f}`;
      const wanted = new Map(rows.map((r) => [key(r.serviceId, r.activeFrom), r]));
      const had = new Map(old.map((r) => [key(r.service_id, r.active_from), r]));
      for (const [k, r] of had)
        if (!wanted.has(k)) await tx.query("DELETE FROM person_service WHERE id = $1", [r.id]);
      // Ends that come sooner go first, so that a row never overlaps one that has not yet moved out of its way.
      const changes = rows
        .filter((r) => {
          const o = had.get(key(r.serviceId, r.activeFrom));
          return o && (o.active_to ?? null) !== r.activeTo;
        })
        .sort((a, b) => ((a.activeTo ?? "9999-12-31") < (b.activeTo ?? "9999-12-31") ? -1 : 1));
      for (const r of changes)
        await tx.query("UPDATE person_service SET active_to = $2 WHERE id = $1", [
          must(had.get(key(r.serviceId, r.activeFrom))).id,
          r.activeTo,
        ]);
      for (const r of rows)
        if (!had.has(key(r.serviceId, r.activeFrom)))
          await tx.query(
            "INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1,$2,$3,$4)",
            [personId, r.serviceId, r.activeFrom, r.activeTo],
          );
    });
  }

  // --- prices, rules, holidays -------------------------------------------

  async listRateCards(actor: Actor): Promise<RateCard[]> {
    this.requireMoney();
    return this.run(actor, (tx) => loadRateCards(tx));
  }

  async addRateCard(
    actor: Actor,
    input: {
      effectiveFrom: string;
      prices: readonly PriceLine[];
      monthlyFee: number;
      note?: string | null;
    },
  ): Promise<{ id: string; warnings: Issue[] }> {
    this.requireMoney();
    this.assertWritable();
    this.mustBeAdmin(actor);
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const warnings = requireOk(checkRateCard(prepare(data), input));
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO rate_card (id, effective_from, monthly_fee, note, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, input.effectiveFrom, input.monthlyFee, input.note ?? null, actor.personId],
      );
      if (input.prices.length > 0)
        await tx.query(
          `INSERT INTO rate_price (card_id, item_id, service_id, amount)
           SELECT $1, i, s, a FROM unnest($2::uuid[], $3::uuid[], $4::bigint[]) AS t(i, s, a)`,
          [
            id,
            input.prices.map((l) => l.itemId),
            input.prices.map((l) => l.serviceId),
            input.prices.map((l) => l.amount),
          ],
        );
      return { id, warnings };
    });
  }

  async listMenus(actor: Actor): Promise<MenuVersion[]> {
    return this.run(actor, (tx) => loadMenus(tx));
  }

  /** A new menu, from a date. It is dated and never edited, and it carries no price. */
  async addMenu(
    actor: Actor,
    input: {
      effectiveFrom: string;
      /** Per service, the meal id on each weekday (0 is Sunday). */
      days: Record<string, Record<string, string>>;
      offered: Record<string, string[]>;
      note?: string | null;
    },
  ): Promise<{ id: string; warnings: Issue[] }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const days = Object.fromEntries(
      Object.entries(input.days).map(([sv, week]) => [
        sv,
        Object.fromEntries(Object.entries(week).map(([wd, meal]) => [Number(wd), meal])),
      ]),
    );
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const warnings = requireOk(
        checkMenu(prepare(data), {
          effectiveFrom: input.effectiveFrom,
          days,
          offered: input.offered,
        }),
      );
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO menu (id, effective_from, note, created_by) VALUES ($1,$2,$3,$4)`,
        [id, input.effectiveFrom, input.note ?? null, actor.personId],
      );
      const offers = Object.entries(input.offered).flatMap(([sv, ids]) =>
        [...new Set(ids)].map((item) => [sv, item] as const),
      );
      if (offers.length > 0)
        await tx.query(
          `INSERT INTO menu_offer (menu_id, service_id, item_id)
           SELECT $1, s, i FROM unnest($2::uuid[], $3::uuid[]) AS t(s, i)`,
          [id, offers.map((o) => o[0]), offers.map((o) => o[1])],
        );
      const cells = Object.entries(days).flatMap(([sv, week]) =>
        Object.entries(week).map(([wd, meal]) => [sv, Number(wd), meal as string] as const),
      );
      if (cells.length > 0)
        await tx.query(
          `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id)
           SELECT $1, s, w, m FROM unnest($2::uuid[], $3::int[], $4::uuid[]) AS t(s, w, m)`,
          [id, cells.map((c) => c[0]), cells.map((c) => c[1]), cells.map((c) => c[2])],
        );
      return { id, warnings };
    });
  }

  async listPolicies(actor: Actor): Promise<{ effectiveFrom: string; doc: PolicyView }[]> {
    return this.run(actor, async (tx) =>
      (
        await tx.query<R>("SELECT effective_from, doc FROM policy_version ORDER BY effective_from")
      ).map((r) => ({
        effectiveFrom: r.effective_from,
        doc: policyView(r.doc as Policy, this.d.info.moneyEnabled),
      })),
    );
  }

  /** A new version of the workspace's rules. It applies from the first of the month it names, never earlier than this month. */
  async addPolicy(actor: Actor, effectiveFrom: string, doc: unknown): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidDate(effectiveFrom) || !effectiveFrom.endsWith("-01"))
      throw invalid("Rules take effect from the first of a month.");
    if (monthOf(effectiveFrom) < monthOf(this.local().date))
      throw invalid("Rules cannot take effect in a month that has already begun.");
    // A kitchen without money has no money rules to choose: whatever is sent for them is set aside, and they
    // are kept at their neutral values.
    const parsed = PolicySchema.safeParse(
      this.d.info.moneyEnabled || typeof doc !== "object" || doc === null
        ? doc
        : { ...(doc as object), ...DEFAULT_MONEY },
    );
    if (!parsed.success)
      throw invalid(
        `These rules are not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      );
    await this.run(actor, async (tx) => {
      await tx.query(
        "INSERT INTO policy_version (effective_from, doc, created_by) VALUES ($1, $2, $3)",
        [
          effectiveFrom,
          JSON.stringify(this.d.info.moneyEnabled ? parsed.data : withoutMoneyRules(parsed.data)),
          actor.personId,
        ],
      );
    });
  }

  /**
   * A holiday on one date, or on each date from `from` to `to`: one row each, weekends too. The rows go in
   * together, so a date in a closed month refuses the lot.
   */
  async addHoliday(
    actor: Actor,
    input: {
      name: string;
      date?: string;
      from?: string;
      to?: string;
      location?: string | null;
      confirmed: boolean;
    },
  ): Promise<{ id: string; ids: string[] }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const made = expandHolidayItem(1, input);
    if ("message" in made) throw invalid(made.message);
    const ids: string[] = [];
    await this.run(actor, async (tx) => {
      for (const day of made.days) {
        const id = crypto.randomUUID();
        await tx.query(
          "INSERT INTO holiday (id, name, on_date, location, confirmed, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, day.name, day.date, day.location, day.confirmed, actor.personId],
        );
        ids.push(id);
      }
    });
    return { id: ids[0] as string, ids };
  }

  /**
   * Many holidays at once. `merge` adds those not already there (the same day, name and place); `overwrite`
   * replaces whatever is on the dates the list names, and nothing on any other date. Each date is tried on
   * its own, so a closed month refuses only its dates, and the answer says which row and why. Unless
   * `partial`, one refusal means nothing is written. A dry run does the same work and takes it back.
   */
  async importHolidays(
    actor: Actor,
    input: {
      mode: HolidayImportMode;
      dryRun: boolean;
      partial?: boolean;
      items?: HolidayImportItem[];
      csv?: string;
    },
  ): Promise<HolidayImportResult> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const entries =
      input.csv !== undefined
        ? parseHolidayCsv(input.csv)
        : {
            items: (input.items ?? []).map((item, i) => ({ row: i + 1, item })),
            problems: [] as RowProblem[],
          };
    if (entries.items.length + entries.problems.length > MAX_HOLIDAY_ROWS)
      throw invalid(`At most ${MAX_HOLIDAY_ROWS} holidays can be imported at a time.`);
    const expanded = expandHolidayItems(entries.items);
    if (expanded.days.length > MAX_HOLIDAY_ROWS)
      throw invalid(
        `That is ${expanded.days.length} days once the ranges are counted; at most ${MAX_HOLIDAY_ROWS} can be imported at a time.`,
      );
    const results: HolidayImportRow[] = [...entries.problems, ...expanded.problems].map((p) => ({
      row: p.row,
      action: "error",
      date: null,
      name: "",
      message: p.message,
    }));
    const days = expanded.days;
    const partial = input.partial === true;

    const out = await this.run(actor, async (tx) => {
      const dates = [...new Set(days.map((d) => d.date))];
      const existing = new Map<string, R[]>();
      if (dates.length > 0)
        for (const h of await tx.query<R>(
          "SELECT id, name, on_date, location, confirmed FROM holiday WHERE on_date = ANY($1::date[]) ORDER BY created_at, id",
          [dates],
        ))
          existing.set(h.on_date, [...(existing.get(h.on_date) ?? []), h]);
      const known = new Set(
        [...existing.values()]
          .flat()
          .map((h) => holidayKey({ date: h.on_date, name: h.name, location: h.location })),
      );

      // What each day will be, in the order given.
      type Plan = { day: HolidayDay; result: HolidayImportRow; write: boolean };
      const plans: Plan[] = [];
      const seen = new Set<string>();
      let removed = 0;
      const replaced = new Set<string>();
      // An overwrite that would put back exactly what a date has leaves it alone, so the same file can be run
      // again (even after the month closed) and writes, and refuses, nothing.
      const asListed = new Set<string>();
      if (input.mode === "overwrite") {
        const listed = new Map<string, Map<string, boolean>>();
        for (const day of days) {
          const m = listed.get(day.date) ?? new Map<string, boolean>();
          if (!m.has(holidayKey(day))) m.set(holidayKey(day), day.confirmed);
          listed.set(day.date, m);
        }
        for (const [date, m] of listed) {
          const old = existing.get(date);
          if (
            old &&
            old.length === m.size &&
            old.every(
              (h) =>
                m.get(holidayKey({ date: h.on_date, name: h.name, location: h.location })) ===
                h.confirmed,
            )
          )
            asListed.add(date);
        }
      }
      for (const day of days) {
        const key = holidayKey(day);
        const result: HolidayImportRow = {
          row: day.row,
          action: "create",
          date: day.date,
          name: day.name,
          message: "Will be added.",
        };
        let write = true;
        if (seen.has(key)) {
          result.action = "skip";
          result.message = "The list has this holiday already.";
          write = false;
        } else if (input.mode === "merge" && known.has(key)) {
          result.action = "skip";
          result.message = "Already there.";
          write = false;
        } else if (asListed.has(day.date)) {
          result.action = "skip";
          result.message = "Already there.";
          write = false;
        } else if (input.mode === "overwrite" && existing.has(day.date)) {
          const old = existing.get(day.date) as R[];
          result.action = "replace";
          result.message = `Takes the place of ${old.map((h) => `“${h.name}”`).join(", ")}.`;
          if (!replaced.has(day.date)) {
            replaced.add(day.date);
            removed += old.length;
          }
        }
        seen.add(key);
        plans.push({ day, result, write });
      }

      // Each date in a savepoint of its own, so that a refusal takes back that date and no other.
      await tx.query("SAVEPOINT holiday_batch");
      for (const date of dates) {
        const mine = plans.filter((p) => p.day.date === date && p.write);
        if (mine.length === 0) continue;
        await tx.query("SAVEPOINT holiday_date");
        try {
          if (replaced.has(date)) await tx.query("DELETE FROM holiday WHERE on_date = $1", [date]);
          for (const p of mine)
            await tx.query(
              "INSERT INTO holiday (name, on_date, location, confirmed, created_by) VALUES ($1,$2,$3,$4,$5)",
              [p.day.name, date, p.day.location, p.day.confirmed, actor.personId],
            );
          await tx.query("RELEASE SAVEPOINT holiday_date");
        } catch (e) {
          const mapped = mapDbError(e);
          if (!(mapped instanceof ApiError) || mapped.code !== "rule") throw e;
          await tx.query("ROLLBACK TO SAVEPOINT holiday_date");
          await tx.query("RELEASE SAVEPOINT holiday_date");
          if (replaced.has(date)) removed -= existing.get(date)?.length ?? 0;
          for (const p of mine) {
            p.result.action = "error";
            p.result.message = mapped.message;
          }
        }
      }
      for (const p of plans) results.push(p.result);

      const refused = results.some((r) => r.action === "error");
      const keep = !input.dryRun && (!refused || partial);
      if (!keep) await tx.query("ROLLBACK TO SAVEPOINT holiday_batch");
      await tx.query("RELEASE SAVEPOINT holiday_batch");
      return { committed: keep, removed };
    });

    results.sort((a, b) => a.row - b.row || (a.date ?? "").localeCompare(b.date ?? ""));
    const count = (a: HolidayImportAction) => results.filter((r) => r.action === a).length;
    return {
      mode: input.mode,
      dryRun: input.dryRun,
      committed: out.committed,
      rows: results,
      summary: {
        create: count("create"),
        replace: count("replace"),
        skip: count("skip"),
        error: count("error"),
        removed: out.removed,
      },
    };
  }

  async updateHoliday(
    actor: Actor,
    id: string,
    input: { name?: string; date?: string; location?: string | null; confirmed?: boolean },
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (input.date !== undefined && !isValidDate(input.date))
      throw invalid(`"${input.date}" is not a date`);
    await this.run(actor, async (tx) => {
      const [h] = await tx.query<R>(
        "SELECT name, on_date, location, confirmed FROM holiday WHERE id = $1",
        [id],
      );
      if (!h) throw notFound("Holiday");
      await tx.query(
        "UPDATE holiday SET name = $2, on_date = $3, location = $4, confirmed = $5 WHERE id = $1",
        [
          id,
          input.name?.trim() ?? h.name,
          input.date ?? h.on_date,
          input.location === undefined ? h.location : input.location,
          input.confirmed ?? h.confirmed,
        ],
      );
    });
  }

  async deleteHoliday(actor: Actor, id: string): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx) => {
      const gone = await tx.query("DELETE FROM holiday WHERE id = $1 RETURNING id", [id]);
      if (gone.length === 0) throw notFound("Holiday");
    });
  }

  // --- the log -----------------------------------------------------------

  async listLog(actor: Actor, range: { from: string; to: string }): Promise<LogEntryDto[]> {
    for (const d of [range.from, range.to])
      if (!isValidDate(d)) throw invalid(`"${d}" is not a date`);
    return this.run(actor, async (tx, load) => {
      const rows = await tx.query<R>(
        `SELECT id, on_date, person_id, all_consumers, action, service_id, item_id, qty, note_enc, logged_by, logged_at
           FROM log_entry WHERE on_date BETWEEN $1 AND $2 ORDER BY on_date, logged_at LIMIT 2000`,
        [range.from, range.to],
      );
      const ctx = await this.historyContext(
        tx,
        actor,
        await load(),
        rows.map((r) => r.logged_by),
      );
      return Promise.all(
        rows.map(
          async (r): Promise<LogEntryDto> => ({
            id: r.id,
            date: r.on_date,
            personId: r.person_id,
            allConsumers: r.all_consumers,
            action: r.action,
            serviceId: r.service_id ?? null,
            itemId: r.item_id ?? null,
            qty: r.qty,
            note: await this.d.cipher.dec("log_entry", "note_enc", r.id, r.note_enc),
            loggedBy: r.logged_by,
            loggedAt: r.logged_at,
            by: whoLabel(r.logged_by, ctx),
            lateByDays: lateByDays(r.on_date, r.logged_at, this.tz),
          }),
        ),
      );
    });
  }

  /** What a reader may know about the people named in what they are reading. */
  private async historyContext(
    tx: Tx,
    actor: Actor,
    data: EngineData,
    ids: Iterable<string | null>,
    claims: ReadonlyMap<
      string,
      { consumerId: string; amount: number; forMonth: string }
    > = new Map(),
  ): Promise<HistoryContext> {
    const names = new Map(data.people.map((x) => [x.id, x.name]));
    const items = new Map(data.catalogue.map((x) => [x.id, x.name]));
    const services = new Map(data.services.map((x) => [x.id, x.name]));
    const roles = new Map<string, Role>();
    for (const id of new Set(ids)) {
      if (id === null) continue;
      // The role of a person is no secret from the people they act on; their name can be.
      const [r] = await tx.query<R>("SELECT role FROM person_billing($1)", [id]);
      if (r) roles.set(id, r.role as Role);
    }
    return {
      viewerId: actor.personId,
      timeZone: this.tz,
      nameOf: (id) => names.get(id),
      roleOf: (id) => roles.get(id),
      itemName: (id) => items.get(id),
      serviceName: (id) => services.get(id),
      severalServices: data.services.length > 1,
      moneyEnabled: this.d.info.moneyEnabled,
      claimOf: (id) => claims.get(id),
    };
  }

  /**
   * What has been done to the reader's own records, newest first, in words. The database decides
   * which rows of the trail a person may read; this only words them.
   */
  async history(
    actor: Actor,
    opts: { before?: number; limit?: number } = {},
  ): Promise<{ events: HistoryEventDto[]; next: number | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.run(actor, async (tx, load) => {
      const rows = await tx.query<R>(
        `SELECT id, table_name, row_id, action, actor, at, via, before, after FROM audit_log
          WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
        [opts.before ?? null, limit],
      );
      const claimRows = await tx.query<R>("SELECT id, consumer_id, amount, for_month FROM claim");
      const claims = new Map(
        claimRows.map((c) => [
          c.id as string,
          {
            consumerId: c.consumer_id as string,
            amount: c.amount as number,
            forMonth: c.for_month as string,
          },
        ]),
      );
      const ctx = await this.historyContext(
        tx,
        actor,
        await load(),
        rows.map((r) => r.actor),
        claims,
      );
      const events: HistoryEventDto[] = [];
      for (const r of rows) {
        const row: AuditRow = {
          id: Number(r.id),
          table: r.table_name,
          rowId: r.row_id,
          action: r.action,
          actor: r.actor,
          at: r.at,
          via: r.via ?? null,
          before: r.before,
          after: r.after,
        };
        const text = describeAudit(row, ctx);
        if (text !== null) events.push({ id: row.id, at: row.at, text });
      }
      return {
        events,
        next: rows.length === limit ? Number(must(rows[rows.length - 1]).id) : null,
      };
    });
  }

  /** The same checks the app runs while the person types, run again here, which is what makes them rules. */
  async checkLog(
    actor: Actor,
    entry: {
      date: string;
      personId: string | null;
      allConsumers: boolean;
      action: LogAction;
      serviceId: string | null;
      itemId: string | null;
      qty: number | null;
    },
  ): Promise<Issue[]> {
    return this.run(actor, async (_tx, load) =>
      checkLogEntry(prepare(await load()), actor, entry, this.local()),
    );
  }

  async addLog(
    actor: Actor,
    input: {
      date: string;
      personId: string | null;
      allConsumers: boolean;
      action: LogAction;
      serviceId: string | null;
      itemId: string | null;
      qty: number | null;
      note?: string | null;
    },
  ): Promise<{ id: string; warnings: Issue[] }> {
    this.assertWritable();
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const warnings = requireOk(checkLogEntry(prepare(data), actor, input, this.local()));
      const id = crypto.randomUUID();
      // The kind is the item's own, so the database can refuse a meal where an add-on belongs.
      const kind = data.catalogue.find((i) => i.id === input.itemId)?.kind ?? null;
      await tx.query(
        `INSERT INTO log_entry (id, on_date, person_id, all_consumers, action, service_id, item_id, item_kind, qty, note_enc, logged_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          input.date,
          input.personId,
          input.allConsumers,
          input.action,
          input.serviceId,
          input.itemId,
          kind,
          input.qty,
          await this.d.cipher.enc("log_entry", "note_enc", id, input.note?.trim() || null),
          actor.personId,
        ],
      );
      return { id, warnings };
    });
  }

  async removeLog(actor: Actor, id: string): Promise<void> {
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      const data = await load();
      const existing = data.log.find((e) => e.id === id);
      if (!existing) throw notFound("Entry");
      requireOk(checkLogChange(prepare(data), actor, existing, this.local()));
      await tx.query("DELETE FROM log_entry WHERE id = $1", [id]);
    });
  }

  // --- payments ----------------------------------------------------------

  async listClaims(actor: Actor): Promise<ClaimDto[]> {
    this.requireMoney();
    return this.run(actor, async (tx) => {
      const rows = await tx.query<R>(
        `SELECT c.id, c.consumer_id, c.paid_at, c.for_month, c.amount, c.method, c.ref_note_enc, c.created_at,
                d.decision, d.note_enc AS decision_note, d.decided_at, r.reason_enc, (r.claim_id IS NOT NULL) AS reversed
           FROM claim c
           LEFT JOIN claim_decision d ON d.claim_id = c.id
           LEFT JOIN claim_reversal r ON r.claim_id = c.id
          ORDER BY c.created_at DESC LIMIT 500`,
      );
      return Promise.all(
        rows.map(
          async (r): Promise<ClaimDto> => ({
            id: r.id,
            consumerId: r.consumer_id,
            paidAt: r.paid_at,
            forMonth: monthOf(r.for_month),
            amount: r.amount,
            method: r.method as PayMethod,
            refNote: await this.d.cipher.dec("claim", "ref_note_enc", r.id, r.ref_note_enc),
            createdAt: r.created_at,
            status: r.reversed ? "Reversed" : (r.decision ?? "Pending"),
            decisionNote: await this.d.cipher.dec(
              "claim_decision",
              "note_enc",
              r.id,
              r.decision_note,
            ),
            decidedAt: r.decided_at ?? null,
            reversalReason: await this.d.cipher.dec(
              "claim_reversal",
              "reason_enc",
              r.id,
              r.reason_enc,
            ),
          }),
        ),
      );
    });
  }

  async addClaim(
    actor: Actor,
    input: {
      consumerId: string;
      paidAt: string;
      forMonth: Month;
      amount: number;
      method: string;
      refNote?: string | null;
    },
  ): Promise<{ id: string }> {
    this.requireMoney();
    this.assertWritable();
    return this.run(actor, async (tx, load) => {
      const data = await load();
      requireOk(checkClaim(prepare(data), actor, input));
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method, ref_note_enc) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          input.consumerId,
          input.paidAt,
          monthStart(input.forMonth),
          input.amount,
          input.method,
          await this.d.cipher.enc("claim", "ref_note_enc", id, input.refNote?.trim() || null),
        ],
      );
      return { id };
    });
  }

  async withdrawClaim(actor: Actor, id: string): Promise<void> {
    this.requireMoney();
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkClaimWithdrawal(prepare(await load()), actor, id));
      const gone = await tx.query("DELETE FROM claim WHERE id = $1 RETURNING id", [id]);
      if (gone.length === 0) throw notFound("Claim");
    });
  }

  async decide(
    actor: Actor,
    claimId: string,
    decision: string,
    note: string | null,
  ): Promise<void> {
    this.requireMoney();
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkDecision(prepare(await load()), actor, claimId, decision, note));
      await tx.query(
        `INSERT INTO claim_decision (claim_id, decision, note_enc, decided_by) VALUES ($1,$2,$3,$4)`,
        [
          claimId,
          decision,
          await this.d.cipher.enc("claim_decision", "note_enc", claimId, note?.trim() || null),
          actor.personId,
        ],
      );
    });
  }

  async reverse(actor: Actor, claimId: string, reason: string): Promise<void> {
    this.requireMoney();
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkReversal(prepare(await load()), actor, claimId, reason));
      await tx.query(
        `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1,$2,$3)`,
        [
          claimId,
          await this.d.cipher.enc("claim_reversal", "reason_enc", claimId, reason.trim()),
          actor.personId,
        ],
      );
    });
  }

  async listSettlements(actor: Actor): Promise<SettlementDto[]> {
    this.requireMoney();
    return this.run(actor, async (tx) => {
      const rows = await tx.query<R>(
        "SELECT id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by, created_at FROM settlement ORDER BY on_date DESC, created_at DESC LIMIT 500",
      );
      return Promise.all(
        rows.map(
          async (r): Promise<SettlementDto> => ({
            id: r.id,
            date: r.on_date,
            consumerId: r.consumer_id,
            forMonth: monthOf(r.for_month),
            type: r.type as SettlementType,
            amount: r.amount ?? null,
            note: await this.d.cipher.dec("settlement", "note_enc", r.id, r.note_enc),
            recordedBy: r.recorded_by,
            createdAt: r.created_at,
          }),
        ),
      );
    });
  }

  async addSettlement(
    actor: Actor,
    input: {
      consumerId: string;
      forMonth: Month;
      type: SettlementType;
      amount?: number | null;
      note?: string | null;
      date?: string;
    },
  ): Promise<{ id: string }> {
    this.requireMoney();
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidMonth(input.forMonth)) throw invalid(`"${input.forMonth}" is not a month`);
    const date = input.date ?? this.local().date;
    if (!isValidDate(date)) throw invalid(`"${date}" is not a date`);
    if (
      input.type === "Payment" &&
      !(Number.isSafeInteger(input.amount) && (input.amount ?? 0) > 0)
    )
      throw invalid("A payment needs an amount above zero.");
    if (input.type !== "Payment" && input.amount) throw invalid("Only a payment has an amount.");
    return this.run(actor, async (tx, load) => {
      const data = await load();
      if (!data.people.some((x) => x.id === input.consumerId && x.role === "consumer"))
        throw notFound("Consumer");
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO settlement (id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          date,
          input.consumerId,
          monthStart(input.forMonth),
          input.type,
          input.type === "Payment" ? input.amount : null,
          await this.d.cipher.enc("settlement", "note_enc", id, input.note?.trim() || null),
          actor.personId,
        ],
      );
      return { id };
    });
  }

  // --- closing months ----------------------------------------------------

  async closeMonth(
    actor: Actor,
    month: Month,
    consumerId?: string,
  ): Promise<{ closed: { consumerId: string; billed?: number; meals: number }[] }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidMonth(month)) throw invalid(`"${month}" is not a month`);
    return this.run(actor, async (tx, load) => {
      const data = await load();
      if (data.today <= monthEnd(month))
        throw invalid("A month can be closed only after it has ended.");
      const p: Prepared = prepare(data);
      const targets = consumers(p).filter((c) =>
        consumerId
          ? c.id === consumerId
          : c.activeFrom !== null &&
            monthOf(c.activeFrom) <= month &&
            (c.activeTo === null || monthOf(c.activeTo) >= month),
      );
      if (consumerId && targets.length === 0) throw notFound("Consumer");
      const closed: { consumerId: string; billed?: number; meals: number }[] = [];
      for (const c of targets) {
        if (data.closes.some((x) => x.consumerId === c.id && x.forMonth === month)) {
          if (consumerId)
            throw new ApiError(409, "conflict", "That month is already closed for this person.");
          continue;
        }
        const snap = closeSnapshot(p, c.id, month);
        await tx.query(
          `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [monthStart(month), c.id, snap.meals, snap.billed, data.today, actor.personId],
        );
        closed.push(
          snap.billed === null
            ? { consumerId: c.id, meals: snap.meals }
            : { consumerId: c.id, meals: snap.meals, billed: snap.billed },
        );
      }
      return { closed };
    });
  }

  async reopenMonth(actor: Actor, month: Month, consumerId: string): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx) => {
      const gone = await tx.query(
        "DELETE FROM month_close WHERE for_month = $1 AND consumer_id = $2 RETURNING consumer_id",
        [monthStart(month), consumerId],
      );
      if (gone.length === 0) throw notFound("Close");
    });
  }

  // --- trail -------------------------------------------------------------

  async audit(
    actor: Actor,
    opts: { before?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    this.mustBeAdmin(actor);
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return this.run(actor, async (tx) => {
      const rows = await tx.query<R>(
        `SELECT id, table_name, row_id, action, actor, at, via, before, after FROM audit_log WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
        [opts.before ?? null, limit],
      );
      const hide = (j: R | null) =>
        j === null
          ? null
          : Object.fromEntries(
              Object.entries(j).map(([k, v]) => [
                k,
                k.endsWith("_enc") && v !== null ? "(encrypted)" : v,
              ]),
            );
      return rows.map((r) => ({
        id: Number(r.id),
        table: r.table_name,
        rowId: r.row_id,
        action: r.action,
        actor: r.actor,
        at: r.at,
        via: r.via ?? null,
        before: hide(r.before),
        after: hide(r.after),
      }));
    });
  }
}
