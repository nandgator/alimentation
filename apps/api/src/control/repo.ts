import type { Limits, Role } from "@alimentation/core";
import type { AgentScope } from "../agent-scopes.ts";
import type { Bytes } from "../crypto/aead.ts";
import type { Db, Row } from "../db/driver.ts";
import type { PlacementRef } from "../placement/types.ts";
import { ApiError } from "../workspace/errors.ts";

// biome-ignore lint/suspicious/noExplicitAny: rows come back from the driver as untyped JSON
type R = Record<string, any>;

export interface AccountRow {
  id: string;
  email: string;
  displayName: string | null;
}

export type WorkspaceState = "ACTIVE" | "MIGRATING" | "MOVED" | "WIPING";

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
  /**
   * The organisation this kitchen shares its totals with, when it does. Read with the kitchen, in the one
   * query that finds it, so a kitchen that shares nothing costs nothing extra and one that does is not asked about
   * again on every request.
   */
  organisationName?: string | null;
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
  organisationName: r.organisation_name ?? null,
});

export interface AgentKeyRow {
  id: string;
  accountId: string;
  workspaceId: string;
  role: Role;
  name: string;
  scopes: AgentScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const toAgentKey = (r: R): AgentKeyRow => ({
  id: r.id,
  accountId: r.account_id,
  workspaceId: r.workspace_id,
  role: r.role,
  name: r.name,
  scopes: r.scopes,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at ?? null,
  revokedAt: r.revoked_at ?? null,
});

const WITH_ORGANISATION = `SELECT w.*, o.name AS organisation_name FROM workspace w
  LEFT JOIN organisation_kitchen k ON k.workspace_id = w.id
  LEFT JOIN organisation o ON o.id = k.organisation_id`;

export interface Wrapped {
  dsnEnc: Bytes;
  dataKeyWrapped: Bytes;
  logKeyWrapped: Bytes;
}

/** All queries on the control database. Holds no business rules; those live in the callers. */
export class ControlRepo {
  /**
   * `now` is the program's clock, not the database's: the times stored here are compared
   * with times the program computes, so both must come from the one clock.
   */
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private stamp = (): string => this.now().toISOString();

  private one<T = R>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    return this.db.tx(async (tx) => (await tx.query<R>(sql, values))[0] as T | undefined);
  }
  private many<T = R>(sql: string, values: unknown[] = []): Promise<T[]> {
    return this.db.tx(async (tx) => (await tx.query<R>(sql, values)) as T[]);
  }

  // --- accounts ------------------------------------------------------------

  /**
   * The account for someone who has just signed in, made if there is none.
   *
   * An account is one email, however the person got in: the same verified email from another identity provider
   * (the instance was pointed at a new one, or at the development sign-in and back) is the same account, so the
   * kitchens it belongs to are not lost. Which provider it is signed in through follows the last one used.
   * A person whose email at their provider has become someone else's here is refused, and told why.
   */
  async upsertAccount(a: {
    issuer: string;
    sub: string;
    email: string;
    name: string | null;
  }): Promise<AccountRow> {
    const email = a.email.trim().toLowerCase();
    const columns = "id, email, display_name";
    const row = (r: R) => ({ id: r.id, email: r.email, displayName: r.display_name });
    // Two sign-ins of one new person at once both find nobody and both try to make them; one of them loses
    // to the unique index, and on the next try finds what the other made.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.tx(async (tx) => {
          const known = await tx.query<R>(
            `UPDATE account SET email = $3, display_name = coalesce($4, display_name), last_login_at = now()
             WHERE idp_issuer = $1 AND idp_sub = $2 RETURNING ${columns}`,
            [a.issuer, a.sub, email, a.name],
          );
          if (known[0]) return row(known[0]);
          const sameEmail = await tx.query<R>(
            `UPDATE account SET idp_issuer = $1, idp_sub = $2, display_name = coalesce($4, display_name), last_login_at = now()
             WHERE email = $3 RETURNING ${columns}`,
            [a.issuer, a.sub, email, a.name],
          );
          if (sameEmail[0]) return row(sameEmail[0]);
          const made = await tx.query<R>(
            `INSERT INTO account (idp_issuer, idp_sub, email, display_name, last_login_at)
             VALUES ($1, $2, $3, $4, now()) RETURNING ${columns}`,
            [a.issuer, a.sub, email, a.name],
          );
          return row(made[0]!);
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") throw e;
        if (attempt >= 3)
          throw new ApiError(
            409,
            "conflict",
            "That email address already belongs to another account here. Ask whoever runs this service.",
          );
      }
    }
  }

  async account(id: string): Promise<AccountRow | undefined> {
    const r = await this.one<R>("SELECT id, email, display_name FROM account WHERE id = $1", [id]);
    return r && { id: r.id, email: r.email, displayName: r.display_name };
  }

  async accountByEmail(email: string): Promise<AccountRow | undefined> {
    const r = await this.one<R>("SELECT id, email, display_name FROM account WHERE email = $1", [
      email.toLowerCase(),
    ]);
    return r && { id: r.id, email: r.email, displayName: r.display_name };
  }

  // --- workspaces ----------------------------------------------------------

  async insertWorkspace(
    w: Omit<WorkspaceRow, "createdAt" | "overSince" | "movedToUrl" | "state"> & {
      createdBy: string | null;
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
    await this.many("DELETE FROM workspace WHERE id = $1", [id]);
  }

  async workspaceBySlug(slug: string): Promise<WorkspaceRow | undefined> {
    const r = await this.one<R>(`${WITH_ORGANISATION} WHERE w.slug = $1`, [slug]);
    return r && toWorkspace(r);
  }

  async workspaceById(id: string): Promise<WorkspaceRow | undefined> {
    const r = await this.one<R>(`${WITH_ORGANISATION} WHERE w.id = $1`, [id]);
    return r && toWorkspace(r);
  }

  async countWorkspaces(): Promise<number> {
    return Number(
      (await this.one<R>(`SELECT count(*)::int AS n FROM workspace WHERE state <> 'WIPING'`))!.n,
    );
  }

  async allWorkspaces(): Promise<WorkspaceRow[]> {
    return (await this.many<R>("SELECT * FROM workspace ORDER BY created_at")).map(toWorkspace);
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
    await this.many("UPDATE workspace SET state = $2, state_since = $3 WHERE id = $1", [
      id,
      state,
      this.stamp(),
    ]);
  }

  /** Takes the move lock: true for the one caller that finds the workspace active. */
  async beginMove(id: string): Promise<boolean> {
    return (
      (
        await this.many(
          `UPDATE workspace SET state = 'MIGRATING', state_since = $2 WHERE id = $1 AND state = 'ACTIVE' RETURNING id`,
          [id, this.stamp()],
        )
      ).length === 1
    );
  }

  /** Workspaces that have been mid-move since before `cutoff`: the move stopped without finishing. */
  async stuckMoving(cutoff: Date): Promise<WorkspaceRow[]> {
    return (
      await this.many<R>(`SELECT * FROM workspace WHERE state = 'MIGRATING' AND state_since < $1`, [
        cutoff.toISOString(),
      ])
    ).map(toWorkspace);
  }

  async setOverSince(id: string, date: string | null): Promise<void> {
    await this.many("UPDATE workspace SET over_since = $2 WHERE id = $1", [id, date]);
  }

  async setLimits(id: string, limits: Limits): Promise<void> {
    await this.many("UPDATE workspace SET limits = $2 WHERE id = $1", [id, JSON.stringify(limits)]);
  }

  // --- organisations ------------------------------------------------------

  async createOrganisation(accountId: string, name: string): Promise<{ id: string; name: string }> {
    return this.db.tx(async (tx) => {
      const [made] = await tx.query<R>(
        `INSERT INTO organisation (name, created_by) VALUES ($1, $2) RETURNING id, name`,
        [name.trim(), accountId],
      );
      await tx.query(
        `INSERT INTO organisation_member (organisation_id, account_id) VALUES ($1, $2)`,
        [made!.id, accountId],
      );
      return { id: made!.id as string, name: made!.name as string };
    });
  }

  async organisationsOf(
    accountId: string,
  ): Promise<{ id: string; name: string; kitchens: number }[]> {
    const rows = await this.many<R>(
      `SELECT o.id, o.name, (SELECT count(*)::int FROM organisation_kitchen k WHERE k.organisation_id = o.id) AS kitchens
         FROM organisation o JOIN organisation_member m ON m.organisation_id = o.id
        WHERE m.account_id = $1 ORDER BY o.created_at`,
      [accountId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, kitchens: r.kitchens }));
  }

  async organisation(id: string): Promise<{ id: string; name: string } | undefined> {
    const r = await this.one<R>("SELECT id, name FROM organisation WHERE id = $1", [id]);
    return r && { id: r.id, name: r.name };
  }

  async isOrganisationMember(organisationId: string, accountId: string): Promise<boolean> {
    return !!(await this.one(
      "SELECT 1 FROM organisation_member WHERE organisation_id = $1 AND account_id = $2",
      [organisationId, accountId],
    ));
  }

  async organisationMembers(
    organisationId: string,
  ): Promise<{ accountId: string; email: string; name: string | null }[]> {
    const rows = await this.many<R>(
      `SELECT a.id, a.email, a.display_name FROM organisation_member m JOIN account a ON a.id = m.account_id
        WHERE m.organisation_id = $1 ORDER BY m.created_at, a.email`,
      [organisationId],
    );
    return rows.map((r) => ({ accountId: r.id, email: r.email, name: r.display_name ?? null }));
  }

  async addOrganisationMember(organisationId: string, accountId: string): Promise<void> {
    await this.many(
      `INSERT INTO organisation_member (organisation_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [organisationId, accountId],
    );
  }

  /** False, and nothing removed, when this is the last member: an organisation is never left with no head office. */
  async removeOrganisationMember(organisationId: string, accountId: string): Promise<boolean> {
    return this.db.tx(async (tx) => {
      await tx.query("SELECT id FROM organisation WHERE id = $1 FOR UPDATE", [organisationId]);
      const [n] = await tx.query<R>(
        "SELECT count(*)::int AS n FROM organisation_member WHERE organisation_id = $1",
        [organisationId],
      );
      if ((n?.n ?? 0) <= 1) return false;
      await tx.query(
        "DELETE FROM organisation_member WHERE organisation_id = $1 AND account_id = $2",
        [organisationId, accountId],
      );
      return true;
    });
  }

  async organisationKitchens(organisationId: string): Promise<WorkspaceRow[]> {
    return (
      await this.many<R>(
        `SELECT w.* FROM organisation_kitchen k JOIN workspace w ON w.id = k.workspace_id
          WHERE k.organisation_id = $1 AND w.state <> 'WIPING' ORDER BY w.display_name, w.slug`,
        [organisationId],
      )
    ).map(toWorkspace);
  }

  /** Makes a kitchen share its totals with an organisation: `other` when it already shares them with another one. */
  async attachKitchen(
    workspaceId: string,
    organisationId: string,
    byAccount: string,
  ): Promise<"attached" | "already" | "other"> {
    return this.db.tx(async (tx) => {
      const made = await tx.query(
        `INSERT INTO organisation_kitchen (workspace_id, organisation_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id) DO NOTHING RETURNING workspace_id`,
        [workspaceId, organisationId, byAccount],
      );
      if (made.length > 0) return "attached";
      const [now] = await tx.query<R>(
        "SELECT organisation_id FROM organisation_kitchen WHERE workspace_id = $1",
        [workspaceId],
      );
      return now?.organisation_id === organisationId ? "already" : "other";
    });
  }

  /** Ends the sharing. With an organisation named, only if it is that one that the kitchen shares with. */
  async detachKitchen(workspaceId: string, organisationId?: string): Promise<boolean> {
    return (
      (
        await this.many(
          `DELETE FROM organisation_kitchen WHERE workspace_id = $1 AND ($2::uuid IS NULL OR organisation_id = $2) RETURNING workspace_id`,
          [workspaceId, organisationId ?? null],
        )
      ).length === 1
    );
  }

  async organisationOfWorkspace(
    workspaceId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const r = await this.one<R>(
      `SELECT o.id, o.name FROM organisation_kitchen k JOIN organisation o ON o.id = k.organisation_id WHERE k.workspace_id = $1`,
      [workspaceId],
    );
    return r && { id: r.id, name: r.name };
  }

  // --- keys for AI agents -----------------------------------------------------

  async createAgentKey(k: {
    accountId: string;
    workspaceId: string;
    role: Role;
    name: string;
    scopes: AgentScope[];
    tokenHash: Bytes;
    expiresAt: Date;
  }): Promise<AgentKeyRow> {
    const r = await this.one<R>(
      `INSERT INTO agent_key (account_id, workspace_id, role, name, scopes, token_hash, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        k.accountId,
        k.workspaceId,
        k.role,
        k.name,
        k.scopes,
        k.tokenHash,
        this.stamp(),
        k.expiresAt.toISOString(),
      ],
    );
    return toAgentKey(r!);
  }

  /** The key a token is for, and the account it acts for, if the token is one that is still good. */
  async agentKeyByHash(
    hash: Bytes,
  ): Promise<(AgentKeyRow & { email: string; displayName: string | null }) | undefined> {
    const r = await this.one<R>(
      `SELECT k.*, a.email, a.display_name FROM agent_key k JOIN account a ON a.id = k.account_id
        WHERE k.token_hash = $1 AND k.revoked_at IS NULL AND k.expires_at > $2`,
      [hash, this.stamp()],
    );
    return r && { ...toAgentKey(r), email: r.email, displayName: r.display_name ?? null };
  }

  /** Says when a key was last used, at most once in five minutes: a read that wrote every time would cost more than it tells. */
  async touchAgentKey(id: string): Promise<void> {
    await this.many(
      `UPDATE agent_key SET last_used_at = $2 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $3)`,
      [id, this.stamp(), new Date(this.now().getTime() - 5 * 60_000).toISOString()],
    );
  }

  async agentKeysOf(accountId: string, workspaceId: string): Promise<AgentKeyRow[]> {
    return (
      await this.many<R>(
        `SELECT * FROM agent_key WHERE account_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
        [accountId, workspaceId],
      )
    ).map(toAgentKey);
  }

  async agentKeysIn(workspaceId: string): Promise<(AgentKeyRow & { ownerEmail: string })[]> {
    return (
      await this.many<R>(
        `SELECT k.*, a.email FROM agent_key k JOIN account a ON a.id = k.account_id
          WHERE k.workspace_id = $1 ORDER BY k.created_at DESC`,
        [workspaceId],
      )
    ).map((r) => ({ ...toAgentKey(r), ownerEmail: r.email }));
  }

  async countActiveAgentKeys(accountId: string, workspaceId: string): Promise<number> {
    return Number(
      (await this.one<R>(
        `SELECT count(*)::int AS n FROM agent_key
            WHERE account_id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
        [accountId, workspaceId, this.stamp()],
      ))!.n,
    );
  }

  /** Ends a key. With an account named, only if it is that account's. */
  async revokeAgentKey(id: string, workspaceId: string, accountId?: string): Promise<boolean> {
    return (
      (
        await this.many(
          `UPDATE agent_key SET revoked_at = $3 WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL
             AND ($4::uuid IS NULL OR account_id = $4) RETURNING id`,
          [id, workspaceId, this.stamp(), accountId ?? null],
        )
      ).length === 1
    );
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
      "SELECT role FROM membership WHERE account_id = $1 AND workspace_id = $2",
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
    const r = await this.one<R>("SELECT * FROM invite WHERE token_hash = $1", [Buffer.from(hash)]);
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
    await this.many("UPDATE invite SET accepted_at = $2 WHERE id = $1", [id, this.stamp()]);
  }

  async pendingInvites(
    workspaceId: string,
  ): Promise<{ personId: string; role: Role; email: string; expiresAt: string }[]> {
    const rows = await this.many<R>(
      `SELECT person_id, role, email, expires_at FROM invite WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > $2`,
      [workspaceId, this.stamp()],
    );
    return rows.map((r) => ({
      personId: r.person_id,
      role: r.role,
      email: r.email,
      expiresAt: r.expires_at,
    }));
  }

  // --- moving and wiping ---------------------------------------------------

  async membersOf(workspaceId: string): Promise<{ personId: string; role: Role; email: string }[]> {
    const rows = await this.many<R>(
      `SELECT m.person_id, m.role, a.email FROM membership m JOIN account a ON a.id = m.account_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
      [workspaceId],
    );
    return rows.map((r) => ({ personId: r.person_id, role: r.role as Role, email: r.email }));
  }

  /** Which sign-in account is which person, for re-linking after the data has been copied elsewhere. */
  async membershipLinks(workspaceId: string): Promise<{ personId: string; accountId: string }[]> {
    const rows = await this.many<R>(
      `SELECT person_id, account_id FROM membership WHERE workspace_id = $1`,
      [workspaceId],
    );
    return rows.map((r) => ({
      personId: r.person_id as string,
      accountId: r.account_id as string,
    }));
  }

  /**
   * Points the workspace at a new database under new keys, and retires the old
   * database with the old keys, in one step. Only the retired record can still open
   * the old copy, and it goes when the copy does.
   */
  async rehome(
    id: string,
    to: {
      placement: PlacementRef;
      dsnEnc: Uint8Array;
      dataKeyWrapped: Uint8Array;
      logKeyWrapped: Uint8Array;
    },
    old: {
      placement: PlacementRef;
      dsnEnc: Uint8Array;
      dataKeyWrapped: Uint8Array;
      logKeyWrapped: Uint8Array;
    },
    destroyAfter: Date,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO retired_database (workspace_id, placement, dsn_enc, data_key_wrapped, log_key_wrapped, destroy_after)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          JSON.stringify(old.placement),
          Buffer.from(old.dsnEnc),
          Buffer.from(old.dataKeyWrapped),
          Buffer.from(old.logKeyWrapped),
          destroyAfter.toISOString(),
        ],
      );
      await tx.query(
        `UPDATE workspace SET placement = $2, dsn_enc = $3, data_key_wrapped = $4, log_key_wrapped = $5,
                state = 'ACTIVE', state_since = $6 WHERE id = $1`,
        [
          id,
          JSON.stringify(to.placement),
          Buffer.from(to.dsnEnc),
          Buffer.from(to.dataKeyWrapped),
          Buffer.from(to.logKeyWrapped),
          this.stamp(),
        ],
      );
    });
  }

  async setMoved(id: string, url: string): Promise<void> {
    await this.many(
      `UPDATE workspace SET state = 'MOVED', state_since = $3, moved_to_url = $2, moved_at = $3 WHERE id = $1`,
      [id, url, this.stamp()],
    );
  }

  /** Notes where a move is headed before it starts, so a move that stalls can be told from one that never began. */
  async setMoveTarget(id: string, url: string | null): Promise<void> {
    await this.many("UPDATE workspace SET moved_to_url = $2 WHERE id = $1", [id, url]);
  }

  async movedBefore(cutoff: Date): Promise<WorkspaceRow[]> {
    return (
      await this.many<R>(`SELECT * FROM workspace WHERE state = 'MOVED' AND moved_at < $1`, [
        cutoff.toISOString(),
      ])
    ).map(toWorkspace);
  }

  /** Workspaces that exist although a receipt says they were wiped: what a restore of this database brings back. */
  async wipedButPresent(): Promise<WorkspaceRow[]> {
    return (
      await this.many<R>(
        `SELECT w.* FROM workspace w JOIN wipe_receipt r ON r.workspace_id = w.id WHERE w.state <> 'WIPING'`,
      )
    ).map(toWorkspace);
  }

  async wiping(): Promise<WorkspaceRow[]> {
    return (await this.many<R>(`SELECT * FROM workspace WHERE state = 'WIPING'`)).map(toWorkspace);
  }

  /** Destroys the keys and marks the workspace as being wiped, in one statement. */
  async destroyKeys(id: string): Promise<void> {
    await this.many(
      `UPDATE workspace SET state = 'WIPING', state_since = $2, data_key_wrapped = NULL, log_key_wrapped = NULL WHERE id = $1`,
      [id, this.stamp()],
    );
  }

  async retiredDue(
    now: Date,
  ): Promise<{ id: string; workspaceId: string; placement: PlacementRef; dsnEnc: Bytes }[]> {
    const rows = await this.many<R>(
      `SELECT id, workspace_id, placement, dsn_enc FROM retired_database WHERE destroyed_at IS NULL AND destroy_after <= $1`,
      [now.toISOString()],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      placement: r.placement,
      dsnEnc: Uint8Array.from(r.dsn_enc),
    }));
  }

  async retiredOf(
    workspaceId: string,
  ): Promise<{ id: string; placement: PlacementRef; dsnEnc: Bytes }[]> {
    const rows = await this.many<R>(
      `SELECT id, placement, dsn_enc FROM retired_database WHERE workspace_id = $1 AND destroyed_at IS NULL`,
      [workspaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      placement: r.placement,
      dsnEnc: Uint8Array.from(r.dsn_enc),
    }));
  }

  /** Retired copies whose keys still exist, for re-wrapping them under a new master key. */
  async retiredWithKeys(): Promise<
    {
      id: string;
      workspaceId: string;
      dsnEnc: Bytes;
      dataKeyWrapped: Bytes;
      logKeyWrapped: Bytes;
    }[]
  > {
    const rows = await this.many<R>(
      `SELECT id, workspace_id, dsn_enc, data_key_wrapped, log_key_wrapped FROM retired_database
        WHERE destroyed_at IS NULL AND data_key_wrapped IS NOT NULL AND log_key_wrapped IS NOT NULL`,
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      dsnEnc: bytes(r.dsn_enc)!,
      dataKeyWrapped: bytes(r.data_key_wrapped)!,
      logKeyWrapped: bytes(r.log_key_wrapped)!,
    }));
  }

  /**
   * Swaps in the same secrets wrapped under a new master key, only if nothing changed in the
   * meantime: a move or a wipe that got there first wins, and keys that were destroyed stay so.
   */
  async rewrapWorkspace(id: string, from: Wrapped, to: Wrapped): Promise<boolean> {
    return (
      (
        await this.many(
          `UPDATE workspace SET dsn_enc = $5, data_key_wrapped = $6, log_key_wrapped = $7
            WHERE id = $1 AND dsn_enc = $2 AND data_key_wrapped = $3 AND log_key_wrapped = $4 RETURNING id`,
          [
            id,
            ...[
              from.dsnEnc,
              from.dataKeyWrapped,
              from.logKeyWrapped,
              to.dsnEnc,
              to.dataKeyWrapped,
              to.logKeyWrapped,
            ].map((b) => Buffer.from(b)),
          ],
        )
      ).length === 1
    );
  }

  async rewrapRetired(id: string, from: Wrapped, to: Wrapped): Promise<boolean> {
    return (
      (
        await this.many(
          `UPDATE retired_database SET dsn_enc = $5, data_key_wrapped = $6, log_key_wrapped = $7
            WHERE id = $1 AND dsn_enc = $2 AND data_key_wrapped = $3 AND log_key_wrapped = $4 RETURNING id`,
          [
            id,
            ...[
              from.dsnEnc,
              from.dataKeyWrapped,
              from.logKeyWrapped,
              to.dsnEnc,
              to.dataKeyWrapped,
              to.logKeyWrapped,
            ].map((b) => Buffer.from(b)),
          ],
        )
      ).length === 1
    );
  }

  /** Destroys the keys that open a retired copy. Done before the copy itself is removed. */
  async shredRetired(id: string): Promise<void> {
    await this.many(
      `UPDATE retired_database SET data_key_wrapped = NULL, log_key_wrapped = NULL WHERE id = $1`,
      [id],
    );
  }

  /** What is kept about a workspace, as counts, for the wipe receipt. */
  async footprint(workspaceId: string): Promise<Record<string, number>> {
    const r = await this.one<R>(
      `SELECT (SELECT count(*) FROM membership WHERE workspace_id = $1)::int AS memberships,
              (SELECT count(*) FROM invite WHERE workspace_id = $1)::int AS invites,
              (SELECT count(*) FROM usage_daily WHERE workspace_id = $1)::int AS usage_days,
              (SELECT count(*) FROM retired_database WHERE workspace_id = $1 AND destroyed_at IS NULL)::int AS retired_databases`,
      [workspaceId],
    );
    return r as Record<string, number>;
  }

  /** Usage counts older than the cutoff; the meter only ever looks two days back. */
  async pruneUsage(before: string): Promise<number> {
    return (await this.many(`DELETE FROM usage_daily WHERE day < $1 RETURNING 1`, [before])).length;
  }

  async pruneInvites(before: Date): Promise<number> {
    return (
      await this.many(
        `DELETE FROM invite WHERE (accepted_at IS NOT NULL OR expires_at < $1) AND created_at < $1 RETURNING 1`,
        [before.toISOString()],
      )
    ).length;
  }

  async deleteRetired(id: string): Promise<void> {
    await this.many(`DELETE FROM retired_database WHERE id = $1`, [id]);
  }

  /**
   * Removes the workspace and everything that points at it, and any account left with no membership anywhere:
   * in a kitchen, or in an organisation's head office.
   */
  async deleteWorkspaceAndOrphans(id: string): Promise<{ accountsRemoved: number }> {
    return this.db.tx(async (tx) => {
      const members = (
        await tx.query<R>(`SELECT DISTINCT account_id FROM membership WHERE workspace_id = $1`, [
          id,
        ])
      ).map((r) => r.account_id as string);
      await tx.query(`DELETE FROM workspace WHERE id = $1`, [id]);
      const gone = members.length
        ? await tx.query(
            `DELETE FROM account a WHERE a.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.account_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM organisation_member om WHERE om.account_id = a.id) RETURNING a.id`,
            [members],
          )
        : [];
      return { accountsRemoved: gone.length };
    });
  }

  async insertReceipt(r: {
    workspaceId: string;
    requestedAt: Date;
    manifest: unknown;
    digest: string;
  }): Promise<void> {
    await this.many(
      `INSERT INTO wipe_receipt (workspace_id, requested_at, manifest, digest) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [r.workspaceId, r.requestedAt.toISOString(), JSON.stringify(r.manifest), r.digest],
    );
  }

  async receipt(workspaceId: string): Promise<R | undefined> {
    return this.one<R>(
      `SELECT workspace_id, requested_at, completed_at, manifest, digest FROM wipe_receipt WHERE workspace_id = $1`,
      [workspaceId],
    );
  }

  // --- invitations that need no link ----------------------------------------

  async createAutoInvite(i: {
    workspaceId: string;
    personId: string;
    role: Role;
    email: string;
    expiresAt: Date;
  }): Promise<void> {
    const hash = crypto.getRandomValues(new Uint8Array(32)); // never shown to anyone: the verified email is the key
    await this.many(
      `INSERT INTO invite (workspace_id, person_id, role, email, token_hash, auto, expires_at) VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [
        i.workspaceId,
        i.personId,
        i.role,
        i.email.toLowerCase(),
        Buffer.from(hash),
        i.expiresAt.toISOString(),
      ],
    );
  }

  async pendingAutoInvites(
    email: string,
    now: Date,
  ): Promise<{ id: string; workspaceId: string; personId: string; role: Role }[]> {
    const rows = await this.many<R>(
      `SELECT id, workspace_id, person_id, role FROM invite WHERE auto AND email = $1 AND accepted_at IS NULL AND expires_at > $2`,
      [email.toLowerCase(), now.toISOString()],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      personId: r.person_id,
      role: r.role as Role,
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
      "SELECT workspace_id, requests FROM usage_daily WHERE day = $1",
      [day],
    );
    return {
      total: rows.reduce((a, r) => a + r.requests, 0),
      byWorkspace: new Map(rows.map((r) => [r.workspace_id, r.requests])),
    };
  }

  async event(kind: string, workspaceId: string | null, detail: Row = {}): Promise<void> {
    await this.many("INSERT INTO platform_event (kind, workspace_id, detail) VALUES ($1,$2,$3)", [
      kind,
      workspaceId,
      JSON.stringify(detail),
    ]);
  }

  async events(limit = 100): Promise<R[]> {
    return this.many<R>(
      "SELECT id, at, kind, workspace_id, detail FROM platform_event ORDER BY id DESC LIMIT $1",
      [limit],
    );
  }
}
