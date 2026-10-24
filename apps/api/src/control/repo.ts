import type { Limits, Role } from '@alimentation/core';
import type { Db, Row } from '../db/driver.ts';
import type { Bytes } from '../crypto/aead.ts';
import type { PlacementRef } from '../placement/types.ts';

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface AccountRow {
  id: string;
  email: string;
  displayName: string | null;
}

export type WorkspaceState = 'ACTIVE' | 'MIGRATING' | 'MOVED' | 'WIPING';

export interface WorkspaceRow {
  id: string;
  slug: string;
  displayName: string;
  state: WorkspaceState;
  placement: PlacementRef;
  dsnEnc: Bytes;
  dataKeyWrapped: Bytes | null;
  logKeyWrapped: Bytes | null;
  timeZone: string;
  limits: Limits;
  overSince: string | null;
  movedToUrl: string | null;
  createdAt: string;
}

// pg hands back Buffers that may share memory; WebCrypto wants plain copies.
const bytes = (b: Uint8Array | null | undefined): Bytes | null => (b ? Uint8Array.from(b) : null);

const toWorkspace = (r: R): WorkspaceRow => ({
  id: r.id,
  slug: r.slug,
  displayName: r.display_name,
  state: r.state,
  placement: r.placement,
  dsnEnc: bytes(r.dsn_enc)!,
  dataKeyWrapped: bytes(r.data_key_wrapped),
  logKeyWrapped: bytes(r.log_key_wrapped),
  timeZone: r.time_zone,
  limits: r.limits,
  overSince: r.over_since ?? null,
  movedToUrl: r.moved_to_url ?? null,
  createdAt: r.created_at,
});

/** All queries on the control database. Holds no business rules; those live in the callers. */
export class ControlRepo {
  constructor(private readonly db: Db) {}

  private one<T = R>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    return this.db.tx(async (tx) => (await tx.query<R>(sql, values))[0] as T | undefined);
  }
  private many<T = R>(sql: string, values: unknown[] = []): Promise<T[]> {
    return this.db.tx(async (tx) => (await tx.query<R>(sql, values)) as T[]);
  }

  // --- accounts ------------------------------------------------------------

  async upsertAccount(a: {
    issuer: string;
    sub: string;
    email: string;
    name: string | null;
  }): Promise<AccountRow> {
    const email = a.email.trim().toLowerCase();
    const r = await this.one<R>(
      `INSERT INTO account (idp_issuer, idp_sub, email, display_name, last_login_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (idp_issuer, idp_sub)
       DO UPDATE SET email = EXCLUDED.email, display_name = coalesce(EXCLUDED.display_name, account.display_name), last_login_at = now()
       RETURNING id, email, display_name`,
      [a.issuer, a.sub, email, a.name],
    );
    return { id: r!.id, email: r!.email, displayName: r!.display_name };
  }

  async account(id: string): Promise<AccountRow | undefined> {
    const r = await this.one<R>('SELECT id, email, display_name FROM account WHERE id = $1', [id]);
    return r && { id: r.id, email: r.email, displayName: r.display_name };
  }

  async accountByEmail(email: string): Promise<AccountRow | undefined> {
    const r = await this.one<R>('SELECT id, email, display_name FROM account WHERE email = $1', [
      email.toLowerCase(),
    ]);
    return r && { id: r.id, email: r.email, displayName: r.display_name };
  }

  // --- workspaces ----------------------------------------------------------

  async insertWorkspace(
    w: Omit<WorkspaceRow, 'createdAt' | 'overSince' | 'movedToUrl' | 'state'> & {
      createdBy: string;
    },
  ): Promise<void> {
    await this.many(
      `INSERT INTO workspace (id, slug, display_name, placement, dsn_enc, data_key_wrapped, log_key_wrapped, time_zone, limits, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        w.id,
        w.slug,
        w.displayName,
        JSON.stringify(w.placement),
        Buffer.from(w.dsnEnc),
        Buffer.from(w.dataKeyWrapped!),
        Buffer.from(w.logKeyWrapped!),
        w.timeZone,
        JSON.stringify(w.limits),
        w.createdBy,
      ],
    );
  }

  async deleteWorkspaceRow(id: string): Promise<void> {
    await this.many('DELETE FROM workspace WHERE id = $1', [id]);
  }

  async workspaceBySlug(slug: string): Promise<WorkspaceRow | undefined> {
    const r = await this.one<R>('SELECT * FROM workspace WHERE slug = $1', [slug]);
    return r && toWorkspace(r);
  }

  async workspaceById(id: string): Promise<WorkspaceRow | undefined> {
    const r = await this.one<R>('SELECT * FROM workspace WHERE id = $1', [id]);
    return r && toWorkspace(r);
  }

  async countWorkspaces(): Promise<number> {
    return Number(
      (await this.one<R>(`SELECT count(*)::int AS n FROM workspace WHERE state <> 'WIPING'`))!.n,
    );
  }

  async allWorkspaces(): Promise<WorkspaceRow[]> {
    return (await this.many<R>('SELECT * FROM workspace ORDER BY created_at')).map(toWorkspace);
  }

  async workspacesOf(accountId: string): Promise<{ workspace: WorkspaceRow; roles: Role[] }[]> {
    const rows = await this.many<R>(
      `SELECT w.*, array_agg(m.role ORDER BY m.role) AS roles
         FROM workspace w JOIN membership m ON m.workspace_id = w.id
        WHERE m.account_id = $1 GROUP BY w.id ORDER BY w.created_at`,
      [accountId],
    );
    return rows.map((r) => ({ workspace: toWorkspace(r), roles: r.roles as Role[] }));
  }

  async setState(id: string, state: WorkspaceState): Promise<void> {
    await this.many('UPDATE workspace SET state = $2 WHERE id = $1', [id, state]);
  }

  async setOverSince(id: string, date: string | null): Promise<void> {
    await this.many('UPDATE workspace SET over_since = $2 WHERE id = $1', [id, date]);
  }

  async setLimits(id: string, limits: Limits): Promise<void> {
    await this.many('UPDATE workspace SET limits = $2 WHERE id = $1', [id, JSON.stringify(limits)]);
  }

  // --- members and invitations -------------------------------------------

  async addMembership(
    accountId: string,
    workspaceId: string,
    personId: string,
    role: Role,
  ): Promise<void> {
    await this.many(
      `INSERT INTO membership (account_id, workspace_id, person_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [accountId, workspaceId, personId, role],
    );
  }

  async rolesOf(accountId: string, workspaceId: string): Promise<Role[]> {
    const rows = await this.many<R>(
      'SELECT role FROM membership WHERE account_id = $1 AND workspace_id = $2',
      [accountId, workspaceId],
    );
    return rows.map((r) => r.role as Role);
  }

  async createInvite(i: {
    workspaceId: string;
    personId: string;
    role: Role;
    email: string;
    tokenHash: Uint8Array;
    expiresAt: Date;
    createdBy: string;
  }): Promise<void> {
    await this.many(
      `INSERT INTO invite (workspace_id, person_id, role, email, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        i.workspaceId,
        i.personId,
        i.role,
        i.email.toLowerCase(),
        Buffer.from(i.tokenHash),
        i.expiresAt.toISOString(),
        i.createdBy,
      ],
    );
  }

  async inviteByHash(hash: Uint8Array): Promise<
    | (R & {
        workspaceId: string;
        personId: string;
        role: Role;
        email: string;
        expiresAt: string;
        acceptedAt: string | null;
      })
    | undefined
  > {
    const r = await this.one<R>('SELECT * FROM invite WHERE token_hash = $1', [Buffer.from(hash)]);
    return (
      r && {
        ...r,
        workspaceId: r.workspace_id,
        personId: r.person_id,
        role: r.role,
        email: r.email,
        expiresAt: r.expires_at,
        acceptedAt: r.accepted_at ?? null,
      }
    );
  }

  async markInviteAccepted(id: string): Promise<void> {
    await this.many('UPDATE invite SET accepted_at = now() WHERE id = $1', [id]);
  }

  async pendingInvites(
    workspaceId: string,
  ): Promise<{ personId: string; role: Role; email: string; expiresAt: string }[]> {
    const rows = await this.many<R>(
      `SELECT person_id, role, email, expires_at FROM invite WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()`,
      [workspaceId],
    );
    return rows.map((r) => ({
      personId: r.person_id,
      role: r.role,
      email: r.email,
      expiresAt: r.expires_at,
    }));
  }

  // --- usage and events ---------------------------------------------------

  async addUsage(
    workspaceId: string,
    day: string,
    requests: number,
    rejected: number,
  ): Promise<void> {
    await this.many(
      `INSERT INTO usage_daily (workspace_id, day, requests, rejected) VALUES ($1,$2,$3,$4)
       ON CONFLICT (workspace_id, day) DO UPDATE SET requests = usage_daily.requests + EXCLUDED.requests, rejected = usage_daily.rejected + EXCLUDED.rejected`,
      [workspaceId, day, requests, rejected],
    );
  }

  /** Requests in the last day: today's count plus the part of yesterday's that is still inside 24 hours. */
  async requestsLast24h(
    workspaceId: string,
    today: string,
    fractionOfDayElapsed: number,
  ): Promise<number> {
    const rows = await this.many<R>(
      `SELECT day, requests FROM usage_daily WHERE workspace_id = $1 AND day >= ($2::date - 1)`,
      [workspaceId, today],
    );
    let total = 0;
    for (const r of rows)
      total += r.day === today ? r.requests : Math.round(r.requests * (1 - fractionOfDayElapsed));
    return total;
  }

  async requestsToday(day: string): Promise<{ total: number; byWorkspace: Map<string, number> }> {
    const rows = await this.many<R>(
      'SELECT workspace_id, requests FROM usage_daily WHERE day = $1',
      [day],
    );
    return {
      total: rows.reduce((a, r) => a + r.requests, 0),
      byWorkspace: new Map(rows.map((r) => [r.workspace_id, r.requests])),
    };
  }

  async event(kind: string, workspaceId: string | null, detail: Row = {}): Promise<void> {
    await this.many('INSERT INTO platform_event (kind, workspace_id, detail) VALUES ($1,$2,$3)', [
      kind,
      workspaceId,
      JSON.stringify(detail),
    ]);
  }

  async events(limit = 100): Promise<R[]> {
    return this.many<R>(
      'SELECT id, at, kind, workspace_id, detail FROM platform_event ORDER BY id DESC LIMIT $1',
      [limit],
    );
  }
}
