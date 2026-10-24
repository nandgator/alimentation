import {
  PolicySchema,
  buildStatements,
  checkClaim,
  checkClaimWithdrawal,
  checkDecision,
  checkLogChange,
  checkLogEntry,
  checkRateCard,
  checkReversal,
  closeSnapshot,
  consumers,
  hasErrors,
  isValidDate,
  isValidMonth,
  ledgerMonth,
  localNow,
  meter as computeMeter,
  monthEnd,
  monthOf,
  monthRange,
  monthStart,
  policyForMonth,
  prepare,
  EngineError,
  STATUS_LABEL,
  type BootstrapDto,
  type ClaimDto,
  type EngineData,
  type Issue,
  type LedgerDto,
  type Limits,
  type LogChange,
  type LogEntryDto,
  type MealType,
  type Month,
  type PayMethod,
  type PersonDto,
  type Policy,
  type Prepared,
  type RateCard,
  type Role,
  type SettlementDto,
  type SettlementType,
  type StatementDto,
  type Usage,
} from '@alimentation/core';
import type { FieldCipher } from '../crypto/fields.ts';
import type { Db, Tx } from '../db/driver.ts';
import { asActor, type Actor } from './context.ts';
import { ApiError, forbidden, invalid, mapDbError, notFound } from './errors.ts';
import { applyAutoCloses, loadEngineData, rateCardFromRow } from './load.ts';

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  currency: string;
  state: 'ACTIVE' | 'MIGRATING' | 'MOVED';
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

const WEEKDAY_COLUMNS = [
  'menu_sun',
  'menu_mon',
  'menu_tue',
  'menu_wed',
  'menu_thu',
  'menu_fri',
  'menu_sat',
] as const;

function requireOk(issues: Issue[]): Issue[] {
  if (hasErrors(issues)) {
    const first = issues.find((i) => i.severity === 'error')!;
    throw invalid(first.message, issues);
  }
  return issues.filter((i) => i.severity === 'warning');
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

  private assertWritable(): void {
    if (this.d.info.state !== 'ACTIVE') {
      throw new ApiError(
        409,
        'read_only',
        this.d.info.state === 'MOVED'
          ? 'This workspace has moved.'
          : 'This workspace is being moved and is read-only.',
      );
    }
  }

  // --- reading -----------------------------------------------------------

  async bootstrap(actor: Actor, roles: Role[]): Promise<BootstrapDto> {
    const info = this.d.info;
    const requests = actor.role === 'admin' ? await this.d.requestsLast24h() : 0;
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const p = prepare(data);
      const today = data.today;
      const current = monthOf(today);
      const me = data.people.find((x) => x.id === actor.personId);

      const setup: BootstrapDto['setup'] = [];
      if (data.rateCards.length === 0)
        setup.push({ code: 'rate_card', message: 'Add a rate card to start billing.' });
      if (!data.people.some((x) => x.role === 'consumer'))
        setup.push({ code: 'consumers', message: 'Add the people you feed.' });

      let statements: StatementDto[] = [];
      if (data.rateCards.length > 0) {
        try {
          const ids = consumers(p).map((c) => c.id);
          statements = this.dto(buildStatements(p, ids, [current]), data);
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          setup.push({ code: e.code.toLowerCase(), message: e.message });
        }
      }

      const [pending] = await tx.query<R>(
        `SELECT count(*)::int AS n FROM claim c WHERE NOT EXISTS (SELECT 1 FROM claim_decision d WHERE d.claim_id = c.id)`,
      );

      let meterOut: BootstrapDto['meter'] = null;
      if (actor.role === 'admin') {
        const usage = await this.measure(tx, requests);
        const m = computeMeter(usage, info.limits, info.overSince, today);
        if (m.overSince !== info.overSince) await this.d.recordOverSince(m.overSince);
        meterOut = { ...m, usage };
      }

      const cards = [...data.rateCards].sort((a, b) =>
        a.effectiveFrom < b.effectiveFrom ? 1 : -1,
      );
      const rateCard = cards.find((c) => c.effectiveFrom <= today) ?? null;
      return {
        workspace: {
          id: info.id,
          slug: info.slug,
          name: info.name,
          timeZone: info.timeZone,
          currency: info.currency,
        },
        me: { personId: actor.personId, role: actor.role, name: me?.name ?? '' },
        roles,
        today,
        currentMonth: current,
        months: monthRange(p),
        policy: policyForMonth(data.policies, current),
        rateCard,
        holidays: [...data.holidays],
        people: await this.peopleDtos(tx, actor, data),
        statements,
        setup,
        pendingClaims: pending?.n ?? 0,
        meter: meterOut,
        workspaceState: info.state,
        movedTo: info.movedTo,
      };
    });
  }

  private async measure(tx: Tx, requests: number): Promise<Usage> {
    const [row] = await tx.query<R>(
      `SELECT (SELECT count(*) FROM person)::int AS people,
              ((SELECT count(*) FROM log_entry) + (SELECT count(*) FROM claim) + (SELECT count(*) FROM settlement) + (SELECT count(*) FROM claim_decision))::int AS rows,
              pg_database_size(current_database())::bigint AS bytes`,
    );
    return {
      requestsLast24h: requests,
      people: row!.people,
      rows: row!.rows,
      bytes: Number(row!.bytes),
    };
  }

  private dto(statements: ReturnType<typeof buildStatements>, data: EngineData): StatementDto[] {
    const names = new Map(data.people.map((x) => [x.id, x.name]));
    return statements.map((s) => ({
      ...s,
      name: names.get(s.personId) ?? '',
      label: STATUS_LABEL[s.status],
    }));
  }

  private async peopleDtos(tx: Tx, actor: Actor, data: EngineData): Promise<PersonDto[]> {
    const rows = await tx.query<R>(
      'SELECT id, status, contact_enc, (account_id IS NOT NULL) AS linked FROM person',
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
          actor.role === 'admin'
            ? await this.d.cipher.dec('person', 'contact_enc', person.id, r.contact_enc)
            : null,
        linked: r.linked,
      });
    }
    return out;
  }

  async statements(actor: Actor, months: Month[], personId?: string): Promise<StatementDto[]> {
    for (const m of months) if (!isValidMonth(m)) throw invalid(`"${m}" is not a month`);
    if (months.length > 36) throw invalid('Ask for at most 36 months at a time.');
    return this.run(actor, async (_tx, load) => {
      const data = await load();
      const p = prepare(data);
      const ids = personId ? [personId] : consumers(p).map((c) => c.id);
      if (personId && !data.people.some((x) => x.id === personId)) throw notFound('Person');
      try {
        return this.dto(buildStatements(p, ids, months), data);
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
      const person = data.people.find((x) => x.id === personId && x.role === 'consumer');
      if (!person) throw notFound('Person');
      try {
        return { personId, month, days: ledgerMonth(prepare(data), person, month) };
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
    },
  ): Promise<{ id: string }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    const name = input.name.trim();
    if (!name || name.length > 120) throw invalid('Give a name of up to 120 characters.');
    if (input.role !== 'consumer' && (input.activeFrom || input.activeTo))
      throw invalid('Only consumers are billed between dates.');
    for (const d of [input.activeFrom, input.activeTo])
      if (d && !isValidDate(d)) throw invalid(`"${d}" is not a date`);
    const id = crypto.randomUUID();
    return this.run(actor, async (tx) => {
      await tx.query(
        `INSERT INTO person (id, role, name_enc, contact_enc, active_from, active_to) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          input.role,
          await this.d.cipher.enc('person', 'name_enc', id, name),
          await this.d.cipher.enc('person', 'contact_enc', id, input.contact?.trim() || null),
          input.activeFrom ?? null,
          input.activeTo ?? null,
        ],
      );
      return { id };
    });
  }

  async updatePerson(
    actor: Actor,
    id: string,
    input: {
      name?: string;
      contact?: string | null;
      activeFrom?: string | null;
      activeTo?: string | null;
      status?: 'ACTIVE' | 'DISABLED';
    },
  ): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx) => {
      const [row] = await tx.query<R>('SELECT role FROM person WHERE id = $1', [id]);
      if (!row) throw notFound('Person');
      const sets: string[] = [];
      const values: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        values.push(v);
        sets.push(`${col} = $${values.length}`);
      };
      if (input.name !== undefined) {
        const n = input.name.trim();
        if (!n || n.length > 120) throw invalid('Give a name of up to 120 characters.');
        set('name_enc', await this.d.cipher.enc('person', 'name_enc', id, n));
      }
      if (input.contact !== undefined)
        set(
          'contact_enc',
          await this.d.cipher.enc('person', 'contact_enc', id, input.contact?.trim() || null),
        );
      for (const [key, col] of [
        ['activeFrom', 'active_from'],
        ['activeTo', 'active_to'],
      ] as const) {
        const v = input[key];
        if (v === undefined) continue;
        if (v !== null && !isValidDate(v)) throw invalid(`"${v}" is not a date`);
        set(col, v);
      }
      if (input.status !== undefined) set('status', input.status);
      if (sets.length === 0) return;
      await tx.query(`UPDATE person SET ${sets.join(', ')} WHERE id = $1`, values);
    });
  }

  /** The role of a person, for the admin deciding what to invite them as. */
  async roleOf(actor: Actor, personId: string): Promise<Role> {
    this.mustBeAdmin(actor);
    return this.run(actor, async (tx) => {
      const [row] = await tx.query<R>('SELECT role FROM person WHERE id = $1', [personId]);
      if (!row) throw notFound('Person');
      return row.role as Role;
    });
  }

  private mustBeAdmin(actor: Actor): void {
    if (actor.role !== 'admin') throw forbidden('Only the admin can do that.');
  }

  // --- prices, rules, holidays -------------------------------------------

  async listRateCards(actor: Actor): Promise<RateCard[]> {
    return this.run(actor, async (tx) =>
      (await tx.query<R>('SELECT * FROM rate_card ORDER BY effective_from')).map(rateCardFromRow),
    );
  }

  async addRateCard(
    actor: Actor,
    input: {
      effectiveFrom: string;
      veg: number;
      nonVeg: number;
      extraChapati: number;
      extraBhakri: number;
      extrasPerMonth: number;
      menu: Partial<Record<number, MealType>>;
      note?: string | null;
    },
  ): Promise<{ id: string; warnings: Issue[] }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const warnings = requireOk(checkRateCard(prepare(data), input.effectiveFrom, input.menu));
      const id = crypto.randomUUID();
      const menuValues = WEEKDAY_COLUMNS.map((_, i) => input.menu[i] ?? null);
      await tx.query(
        `INSERT INTO rate_card (id, effective_from, veg, non_veg, extra_chapati, extra_bhakri, extras_per_month,
            menu_sun, menu_mon, menu_tue, menu_wed, menu_thu, menu_fri, menu_sat, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          input.effectiveFrom,
          input.veg,
          input.nonVeg,
          input.extraChapati,
          input.extraBhakri,
          input.extrasPerMonth,
          ...menuValues,
          input.note ?? null,
          actor.personId,
        ],
      );
      return { id, warnings };
    });
  }

  async listPolicies(actor: Actor): Promise<{ effectiveFrom: string; doc: Policy }[]> {
    return this.run(actor, async (tx) =>
      (
        await tx.query<R>('SELECT effective_from, doc FROM policy_version ORDER BY effective_from')
      ).map((r) => ({ effectiveFrom: r.effective_from, doc: r.doc })),
    );
  }

  /** A new version of the workspace's rules. It applies from the first of the month it names, never earlier than this month. */
  async addPolicy(actor: Actor, effectiveFrom: string, doc: unknown): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidDate(effectiveFrom) || !effectiveFrom.endsWith('-01'))
      throw invalid('Rules take effect from the first of a month.');
    if (monthOf(effectiveFrom) < monthOf(this.local().date))
      throw invalid('Rules cannot take effect in a month that has already begun.');
    const parsed = PolicySchema.safeParse(doc);
    if (!parsed.success)
      throw invalid(
        `These rules are not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    await this.run(actor, async (tx) => {
      await tx.query(
        'INSERT INTO policy_version (effective_from, doc, created_by) VALUES ($1, $2, $3)',
        [effectiveFrom, JSON.stringify(parsed.data), actor.personId],
      );
    });
  }

  async addHoliday(
    actor: Actor,
    input: { name: string; date: string; location?: string | null; confirmed: boolean },
  ): Promise<{ id: string }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidDate(input.date)) throw invalid(`"${input.date}" is not a date`);
    const id = crypto.randomUUID();
    await this.run(actor, async (tx) => {
      await tx.query(
        'INSERT INTO holiday (id, name, on_date, location, confirmed, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          id,
          input.name.trim(),
          input.date,
          input.location ?? null,
          input.confirmed,
          actor.personId,
        ],
      );
    });
    return { id };
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
        'SELECT name, on_date, location, confirmed FROM holiday WHERE id = $1',
        [id],
      );
      if (!h) throw notFound('Holiday');
      await tx.query(
        'UPDATE holiday SET name = $2, on_date = $3, location = $4, confirmed = $5 WHERE id = $1',
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
      const gone = await tx.query('DELETE FROM holiday WHERE id = $1 RETURNING id', [id]);
      if (gone.length === 0) throw notFound('Holiday');
    });
  }

  // --- the log -----------------------------------------------------------

  async listLog(actor: Actor, range: { from: string; to: string }): Promise<LogEntryDto[]> {
    for (const d of [range.from, range.to])
      if (!isValidDate(d)) throw invalid(`"${d}" is not a date`);
    return this.run(actor, async (tx) => {
      const rows = await tx.query<R>(
        `SELECT id, on_date, person_id, all_consumers, change, qty, note_enc, logged_by, logged_at
           FROM log_entry WHERE on_date BETWEEN $1 AND $2 ORDER BY on_date, logged_at LIMIT 2000`,
        [range.from, range.to],
      );
      return Promise.all(
        rows.map(async (r): Promise<LogEntryDto> => ({
          id: r.id,
          date: r.on_date,
          personId: r.person_id,
          allConsumers: r.all_consumers,
          change: r.change,
          qty: r.qty,
          note: await this.d.cipher.dec('log_entry', 'note_enc', r.id, r.note_enc),
          loggedBy: r.logged_by,
          loggedAt: r.logged_at,
        })),
      );
    });
  }

  /** The same checks the app runs while the person types, run again here, which is what makes them rules. */
  async checkLog(
    actor: Actor,
    entry: {
      date: string;
      personId: string | null;
      allConsumers: boolean;
      change: LogChange;
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
      change: LogChange;
      qty: number | null;
      note?: string | null;
    },
  ): Promise<{ id: string; warnings: Issue[] }> {
    this.assertWritable();
    return this.run(actor, async (tx, load) => {
      const data = await load();
      const warnings = requireOk(checkLogEntry(prepare(data), actor, input, this.local()));
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO log_entry (id, on_date, person_id, all_consumers, change, qty, note_enc, logged_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          input.date,
          input.personId,
          input.allConsumers,
          input.change,
          input.qty,
          await this.d.cipher.enc('log_entry', 'note_enc', id, input.note?.trim() || null),
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
      if (!existing) throw notFound('Entry');
      requireOk(checkLogChange(prepare(data), actor, existing, this.local()));
      await tx.query('DELETE FROM log_entry WHERE id = $1', [id]);
    });
  }

  // --- payments ----------------------------------------------------------

  async listClaims(actor: Actor): Promise<ClaimDto[]> {
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
        rows.map(async (r): Promise<ClaimDto> => ({
          id: r.id,
          consumerId: r.consumer_id,
          paidAt: r.paid_at,
          forMonth: monthOf(r.for_month),
          amount: r.amount,
          method: r.method as PayMethod,
          refNote: await this.d.cipher.dec('claim', 'ref_note_enc', r.id, r.ref_note_enc),
          createdAt: r.created_at,
          status: r.reversed ? 'Reversed' : (r.decision ?? 'Pending'),
          decisionNote: await this.d.cipher.dec(
            'claim_decision',
            'note_enc',
            r.id,
            r.decision_note,
          ),
          decidedAt: r.decided_at ?? null,
          reversalReason: await this.d.cipher.dec(
            'claim_reversal',
            'reason_enc',
            r.id,
            r.reason_enc,
          ),
        })),
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
          await this.d.cipher.enc('claim', 'ref_note_enc', id, input.refNote?.trim() || null),
        ],
      );
      return { id };
    });
  }

  async withdrawClaim(actor: Actor, id: string): Promise<void> {
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkClaimWithdrawal(prepare(await load()), actor, id));
      const gone = await tx.query('DELETE FROM claim WHERE id = $1 RETURNING id', [id]);
      if (gone.length === 0) throw notFound('Claim');
    });
  }

  async decide(
    actor: Actor,
    claimId: string,
    decision: string,
    note: string | null,
  ): Promise<void> {
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkDecision(prepare(await load()), actor, claimId, decision, note));
      await tx.query(
        `INSERT INTO claim_decision (claim_id, decision, note_enc, decided_by) VALUES ($1,$2,$3,$4)`,
        [
          claimId,
          decision,
          await this.d.cipher.enc('claim_decision', 'note_enc', claimId, note?.trim() || null),
          actor.personId,
        ],
      );
    });
  }

  async reverse(actor: Actor, claimId: string, reason: string): Promise<void> {
    this.assertWritable();
    await this.run(actor, async (tx, load) => {
      requireOk(checkReversal(prepare(await load()), actor, claimId, reason));
      await tx.query(
        `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1,$2,$3)`,
        [
          claimId,
          await this.d.cipher.enc('claim_reversal', 'reason_enc', claimId, reason.trim()),
          actor.personId,
        ],
      );
    });
  }

  async listSettlements(actor: Actor): Promise<SettlementDto[]> {
    return this.run(actor, async (tx) => {
      const rows = await tx.query<R>(
        'SELECT id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by, created_at FROM settlement ORDER BY on_date DESC, created_at DESC LIMIT 500',
      );
      return Promise.all(
        rows.map(async (r): Promise<SettlementDto> => ({
          id: r.id,
          date: r.on_date,
          consumerId: r.consumer_id,
          forMonth: monthOf(r.for_month),
          type: r.type as SettlementType,
          amount: r.amount ?? null,
          note: await this.d.cipher.dec('settlement', 'note_enc', r.id, r.note_enc),
          recordedBy: r.recorded_by,
          createdAt: r.created_at,
        })),
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
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidMonth(input.forMonth)) throw invalid(`"${input.forMonth}" is not a month`);
    const date = input.date ?? this.local().date;
    if (!isValidDate(date)) throw invalid(`"${date}" is not a date`);
    if (
      input.type === 'Payment' &&
      !(Number.isSafeInteger(input.amount) && (input.amount ?? 0) > 0)
    )
      throw invalid('A payment needs an amount above zero.');
    if (input.type !== 'Payment' && input.amount) throw invalid('Only a payment has an amount.');
    return this.run(actor, async (tx, load) => {
      const data = await load();
      if (!data.people.some((x) => x.id === input.consumerId && x.role === 'consumer'))
        throw notFound('Consumer');
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO settlement (id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          date,
          input.consumerId,
          monthStart(input.forMonth),
          input.type,
          input.type === 'Payment' ? input.amount : null,
          await this.d.cipher.enc('settlement', 'note_enc', id, input.note?.trim() || null),
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
  ): Promise<{ closed: { consumerId: string; billed: number; meals: number }[] }> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    if (!isValidMonth(month)) throw invalid(`"${month}" is not a month`);
    return this.run(actor, async (tx, load) => {
      const data = await load();
      if (data.today <= monthEnd(month))
        throw invalid('A month can be closed only after it has ended.');
      const p: Prepared = prepare(data);
      const targets = consumers(p).filter((c) =>
        consumerId
          ? c.id === consumerId
          : c.activeFrom !== null &&
            monthOf(c.activeFrom) <= month &&
            (c.activeTo === null || monthOf(c.activeTo) >= month),
      );
      if (consumerId && targets.length === 0) throw notFound('Consumer');
      const closed: { consumerId: string; billed: number; meals: number }[] = [];
      for (const c of targets) {
        if (data.closes.some((x) => x.consumerId === c.id && x.forMonth === month)) {
          if (consumerId)
            throw new ApiError(409, 'conflict', 'That month is already closed for this person.');
          continue;
        }
        const snap = closeSnapshot(p, c.id, month);
        await tx.query(
          `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [monthStart(month), c.id, snap.meals, snap.billed, data.today, actor.personId],
        );
        closed.push({ consumerId: c.id, ...snap });
      }
      return { closed };
    });
  }

  async reopenMonth(actor: Actor, month: Month, consumerId: string): Promise<void> {
    this.assertWritable();
    this.mustBeAdmin(actor);
    await this.run(actor, async (tx) => {
      const gone = await tx.query(
        'DELETE FROM month_close WHERE for_month = $1 AND consumer_id = $2 RETURNING consumer_id',
        [monthStart(month), consumerId],
      );
      if (gone.length === 0) throw notFound('Close');
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
        `SELECT id, table_name, row_id, action, actor, at, before, after FROM audit_log WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
        [opts.before ?? null, limit],
      );
      const hide = (j: R | null) =>
        j === null
          ? null
          : Object.fromEntries(
              Object.entries(j).map(([k, v]) => [
                k,
                k.endsWith('_enc') && v !== null ? '(encrypted)' : v,
              ]),
            );
      return rows.map((r) => ({
        id: Number(r.id),
        table: r.table_name,
        rowId: r.row_id,
        action: r.action,
        actor: r.actor,
        at: r.at,
        before: hide(r.before),
        after: hide(r.after),
      }));
    });
  }
}
