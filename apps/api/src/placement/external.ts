import { migrate } from '../db/migrate.ts';
import type { Db } from '../db/driver.ts';
import { WORKSPACE_MIGRATIONS } from '../db/migrations.generated.ts';
import {
  randomSecret,
  type Credentials,
  type Placement,
  type PlacementRef,
  type Provisioned,
} from './types.ts';

/** Everything a workspace database contains that this program put there, and nothing else. */
export const OUR_TABLES = [
  'audit_log',
  'month_close',
  'settlement',
  'claim_reversal',
  'claim_decision',
  'claim',
  'log_entry',
  'holiday',
  'rate_card',
  'policy_version',
  'person',
  'workspace',
  'meta',
  'schema_migration',
] as const;
export const OUR_DOMAINS = ['enc_blob', 'paise'] as const;

export interface TargetCheck {
  ok: boolean;
  problems: string[];
  ownerUrl: string;
  appUrl: string | null;
  /** True once something was created in the database, so a failed attempt knows to clean up. */
  touched: boolean;
}

const withUser = (url: string, user: string, password: string) => {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
};

/**
 * Gets someone else's empty Postgres ready to hold a workspace: checks it is Postgres
 * 15 or later and holds none of our tables with data in them, makes the application
 * role, and runs the migrations. Safe to run again on a database it prepared before.
 */
export async function prepareExternalTarget(
  openDb: (dsn: string, o?: { ephemeral?: boolean }) => Db,
  ownerUrl: string,
  opts: { checkOnly?: boolean } = {},
): Promise<TargetCheck> {
  const result: TargetCheck = { ok: false, problems: [], ownerUrl, appUrl: null, touched: false };
  let u: URL;
  try {
    u = new URL(ownerUrl);
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('scheme');
  } catch {
    result.problems.push(
      'That is not a Postgres connection string (postgres://user:password@host/database).',
    );
    return result;
  }
  const db = openDb(ownerUrl, { ephemeral: true });
  try {
    const info = await db.tx(async (tx) => {
      const [v] = await tx.query<{ v: number; db: string; can: boolean; me: string }>(
        `SELECT current_setting('server_version_num')::int AS v, current_database() AS db, current_user AS me,
                (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = current_user) AS can`,
      );
      const present = await tx.query<{ t: string }>(
        `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [[...OUR_TABLES]],
      );
      let populated = 0;
      for (const { t } of present) {
        if (['meta', 'schema_migration'].includes(t)) continue;
        populated += Number(
          (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`))[0]!.n,
        );
      }
      return { ...v!, populated };
    });
    if (info.v < 150000)
      result.problems.push(
        `This Postgres is version ${Math.floor(info.v / 10000)}; version 15 or later is needed.`,
      );
    if (info.populated > 0)
      result.problems.push(
        'This database already holds a workspace or other records of ours. Use an empty database.',
      );
    if (!info.can)
      result.problems.push(
        'The user in this connection string cannot create roles. Use the owner role of the project (on Neon, the default role), or create an application role yourself.',
      );
    if (result.problems.length) return result;
    if (opts.checkOnly) {
      result.ok = true;
      return result;
    }

    result.touched = true;
    const role = `alim_app_${randomSecret(5)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, 'x')}`;
    const password = randomSecret();
    const existing = await db.tx(
      async (tx) =>
        await tx
          .query<{ value: string }>(`SELECT value FROM meta WHERE key = 'app_role'`)
          .catch(() => []),
    );
    const appRole = existing[0]?.value ?? role;
    await db.tx(async (tx) => {
      if (existing[0]) {
        const alter = await tx.query<{ q: string }>(
          `SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS q`,
          [appRole, password],
        );
        await tx.query(alter[0]!.q);
      } else {
        const create = await tx.query<{ q: string }>(
          `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10', $1::text, $2::text) AS q`,
          [appRole, password],
        );
        await tx.query(create[0]!.q);
        const grant = await tx.query<{ q: string }>(
          `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS q`,
          [appRole],
        );
        await tx.query(grant[0]!.q);
      }
    });
    await db.withClient((c) =>
      migrate(c, WORKSPACE_MIGRATIONS, { settings: { 'alimentation.app_role': appRole } }),
    );
    result.appUrl = withUser(ownerUrl, appRole, password);
    result.ok = true;
    return result;
  } catch (e) {
    result.problems.push(`Could not prepare the database: ${(e as Error).message}`);
    return result;
  } finally {
    await db.close();
  }
}

/**
 * A workspace living in a database someone else owns. It can be removed from there
 * without touching anything else they keep in it: only the objects named in
 * `OUR_TABLES` and `OUR_DOMAINS`, and the functions this program defines, go.
 */
export class ExternalPlacement implements Placement {
  readonly kind = 'external' as const;
  constructor(private readonly openDb: (dsn: string, o?: { ephemeral?: boolean }) => Db) {}

  async provision(): Promise<Provisioned> {
    throw new Error('an external database is prepared with prepareExternalTarget, not provisioned');
  }

  async exists(_ref: PlacementRef, creds?: Credentials): Promise<boolean> {
    if (!creds) return false;
    const db = this.openDb(creds.ownerUrl, { ephemeral: true });
    try {
      return await db.tx(
        async (tx) =>
          (
            await tx.query(
              `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspace'`,
            )
          ).length > 0,
      );
    } catch {
      return false;
    } finally {
      await db.close();
    }
  }

  async destroy(_ref: PlacementRef, creds?: Credentials): Promise<void> {
    if (!creds)
      throw new Error('removing a workspace from an external database needs its connection');
    const db = this.openDb(creds.ownerUrl, { ephemeral: true });
    try {
      await db.tx(async (tx) => {
        const role = (
          await tx
            .query<{ value: string }>(`SELECT value FROM meta WHERE key = 'app_role'`)
            .catch(() => [])
        )[0]?.value;
        const fns = await tx.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
              AND p.proname = ANY($1) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
          [[...OUR_FUNCTIONS]],
        );
        for (const t of OUR_TABLES) await tx.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
        for (const f of fns) await tx.query(`DROP FUNCTION IF EXISTS ${f.sig} CASCADE`);
        for (const d of OUR_DOMAINS) await tx.query(`DROP DOMAIN IF EXISTS public.${d} CASCADE`);
        if (role) {
          const drop = await tx.query<{ a: string; b: string }>(
            `SELECT format('REASSIGN OWNED BY %I TO %I', $1::text, current_user) AS a, format('DROP OWNED BY %I', $1::text) AS b`,
            [role],
          );
          if ((await tx.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).length) {
            await tx.query(drop[0]!.a);
            await tx.query(drop[0]!.b);
            const gone = await tx.query<{ q: string }>(
              `SELECT format('DROP ROLE %I', $1::text) AS q`,
              [role],
            );
            await tx.query(gone[0]!.q);
          }
        }
      });
    } finally {
      await db.close();
    }
  }
}

/** The functions this program defines in a workspace database; a test keeps this list honest. */
export const OUR_FUNCTIONS = [
  'is_app_session',
  'app_role',
  'app_person',
  'workspace_time_zone_known',
  'workspace_today',
  'policy_on',
  'is_working_day',
  'month_closed',
  'close_blocks_admin',
  'forbid_change',
  'person_billing',
  'stamp_log_entry',
  'stamp_decision',
  'stamp_reversal',
  'stamp_settlement',
  'stamp_claim',
  'guard_holiday',
  'guard_read_only',
  'enforce_people_cap',
  'enforce_row_cap',
  'audit_row',
  'resolve_actor',
  'bind_account',
  'system_close_month',
  'schema_version',
  'grant_to_app',
] as const;
