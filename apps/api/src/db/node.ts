import pg from 'pg';
import { dbFromPool, pgTypes, type Db } from './driver.ts';

/** A pool of connections over `pg`, for Node. */
export function nodeDb(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 5,
    types: pgTypes((oid, format) =>
      pg.types.getTypeParser(oid, format as 'text'),
    ) as unknown as pg.CustomTypesConfig,
  });
  // A connection that drops while idle (the database restarting, a deploy) must not take the process down.
  pool.on('error', () => undefined);
  return dbFromPool(pool as unknown as Parameters<typeof dbFromPool>[0]);
}

/**
 * Keeps one pool per connection string for the life of the process. `ephemeral`
 * connections are made fresh and are the caller's to close.
 */
export function nodeOpenDb(): ((dsn: string, opts?: { ephemeral?: boolean }) => Db) & {
  closeAll(): Promise<void>;
} {
  const pools = new Map<string, Db>();
  const open = (dsn: string, opts?: { ephemeral?: boolean }): Db => {
    if (opts?.ephemeral) return nodeDb(dsn, { max: 2 });
    let db = pools.get(dsn);
    if (!db) {
      db = nodeDb(dsn);
      pools.set(dsn, db);
    }
    return db;
  };
  return Object.assign(open, {
    async closeAll() {
      await Promise.all([...pools.values()].map((d) => d.close()));
      pools.clear();
    },
  });
}
