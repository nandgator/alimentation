/**
 * Forward-only SQL migrations, applied one at a time under an advisory lock.
 *
 * The runner needs only `query`, so it runs over `pg` on Node and over the Neon
 * driver on Workers. An applied migration is remembered with a checksum; if its
 * text has since changed the runner refuses to continue, because a database that
 * was migrated from different text than the code now carries is a database nobody
 * can reason about.
 */

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export class MigrationDriftError extends Error {
  constructor(version: number, name: string) {
    super(`migration ${version} (${name}) was changed after it was applied`);
    this.name = 'MigrationDriftError';
  }
}

export async function checksum(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MigrateResult {
  applied: number[];
  current: number;
}

const LOCK_KEY = 727_274;

export async function migrate(
  client: SqlClient,
  migrations: readonly Migration[],
  opts: { settings?: Record<string, string> } = {},
): Promise<MigrateResult> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i]!.version !== i + 1)
      throw new Error(
        `migrations must be numbered 1..n without gaps (found ${ordered[i]!.version})`,
      );
  }

  // Even CREATE TABLE IF NOT EXISTS can race with itself, so it too runs under the lock.
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }

  const applied: number[] = [];
  for (const m of ordered) {
    const sum = await checksum(m.sql);
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const done = await client.query('SELECT checksum FROM schema_migration WHERE version = $1', [
        m.version,
      ]);
      if (done.rows.length > 0) {
        if (done.rows[0]!.checksum !== sum) throw new MigrationDriftError(m.version, m.name);
        await client.query('COMMIT');
        continue;
      }
      for (const [k, v] of Object.entries(opts.settings ?? {})) {
        await client.query('SELECT set_config($1, $2, true)', [k, v]);
      }
      await client.query(m.sql);
      await client.query(
        'INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)',
        [m.version, m.name, sum],
      );
      await client.query('COMMIT');
      applied.push(m.version);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  }
  const cur = await client.query('SELECT coalesce(max(version), 0) AS v FROM schema_migration');
  return { applied, current: Number(cur.rows[0]!.v) };
}

/** The version a database is at, without changing it. Zero when it was never migrated. */
export async function currentVersion(client: SqlClient): Promise<number> {
  const t = await client.query(`SELECT to_regclass('schema_migration') IS NOT NULL AS present`);
  if (!t.rows[0]!.present) return 0;
  const r = await client.query('SELECT coalesce(max(version), 0) AS v FROM schema_migration');
  return Number(r.rows[0]!.v);
}
