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
  return dbFromPool(pool as unknown as Parameters<typeof dbFromPool>[0]);
}
