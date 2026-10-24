import { Client, neonConfig, types } from '@neondatabase/serverless';
import { dbFromPool, pgTypes, type Db } from './driver.ts';

/**
 * A database reached over Neon's serverless driver, for Cloudflare Workers.
 *
 * A Worker may not carry a connection from one request to the next, so there is no
 * pool: each transaction opens its own connection and closes it when done. The driver
 * speaks over a WebSocket, which is what a Worker is allowed to open.
 */
export function neonDb(connectionString: string): Db {
  const parsers = pgTypes((oid, format) => types.getTypeParser(oid, format as 'text'));
  return dbFromPool({
    async connect() {
      const client = new Client({
        connectionString,
        types: parsers as never,
      });
      await client.connect();
      return {
        query: (text: string, values?: unknown[]) => client.query(text, values),
        release: () => void client.end().catch(() => undefined),
      } as Awaited<ReturnType<Parameters<typeof dbFromPool>[0]['connect']>>;
    },
    async end() {},
  });
}

/** One `Db` per connection string for the life of the isolate; each call still opens its own connection. */
export function neonOpenDb(): (dsn: string, opts?: { ephemeral?: boolean }) => Db {
  const dbs = new Map<string, Db>();
  return (dsn, opts) => {
    if (opts?.ephemeral) return neonDb(dsn);
    let db = dbs.get(dsn);
    if (!db) dbs.set(dsn, (db = neonDb(dsn)));
    return db;
  };
}

/**
 * Points the driver at a plain Postgres through a WebSocket proxy, for running a Worker
 * on one machine (`NEON_WS_PROXY=127.0.0.1:5488/v1`). Never set on the deployed service.
 */
export function useLocalProxy(hostAndPath: string): void {
  neonConfig.wsProxy = hostAndPath;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}
