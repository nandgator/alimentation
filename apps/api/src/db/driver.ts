/**
 * The smallest database interface the service layer needs: run statements inside
 * a transaction. It sits over `pg` on Node and over the Neon driver on Workers,
 * which share a Pool/Client shape, so nothing above this file knows which.
 */

export type Row = Record<string, unknown>;

export interface Tx {
  query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]>;
}

export interface Db {
  /** `snapshot` runs read-only at repeatable-read: one consistent picture of everything read. */
  tx<T>(fn: (tx: Tx) => Promise<T>, opts?: { snapshot?: boolean }): Promise<T>;
  /** Lends one connection, outside any transaction, to code that manages its own (the migration runner). */
  withClient<T>(
    fn: (client: {
      query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
    }) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

interface ClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  release(err?: Error | boolean): void;
}

export interface PoolLike {
  connect(): Promise<ClientLike>;
  end(): Promise<void>;
}

export function dbFromPool(pool: PoolLike): Db {
  return {
    async tx(fn, opts) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query(
          opts?.snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
        );
        const tx: Tx = {
          async query<R extends Row = Row>(text: string, values?: unknown[]) {
            return (await client.query(text, values)).rows as R[];
          },
        };
        const out = await fn(tx);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          broken = true; // a connection that cannot roll back is not reused
        }
        throw e;
      } finally {
        client.release(broken);
      }
    },
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

type Parser = (v: string) => unknown;

/**
 * Dates stay strings (`2026-10-24`), instants become ISO strings, and bigints
 * become numbers (paise stay far below 2^53). The engine works on exactly these.
 * Everything else is left to the driver's own parsers, which is what turns bytea
 * into bytes and jsonb into objects.
 */
export function pgTypes(fallback: (oid: number, format?: 'text' | 'binary') => Parser) {
  return {
    getTypeParser(oid: number, format?: 'text' | 'binary'): Parser {
      if (format === 'binary') return fallback(oid, format);
      switch (oid) {
        case 1082: // date
          return (v) => v;
        case 1184: // timestamptz
        case 1114: // timestamp
          return (v) => new Date(v).toISOString();
        case 20: // int8
        case 1700: // numeric
          return (v) => Number(v);
        default:
          return fallback(oid, format);
      }
    },
  };
}
