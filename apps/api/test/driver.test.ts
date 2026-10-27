import { describe, expect, it } from 'vitest';
import { dbFromPool, type PoolLike } from '../src/db/driver.ts';

/** A pool whose one connection refuses to be asked a second thing while it is busy, as pg 9 will. */
function strictPool(fail?: (text: string) => boolean) {
  const seen: string[] = [];
  let busy = false;
  const client = {
    async query(text: string) {
      if (busy) throw new Error(`overlapping statement: ${text}`);
      busy = true;
      seen.push(text);
      await new Promise((r) => setTimeout(r, text.startsWith('SELECT 1') ? 15 : 1));
      busy = false;
      if (fail?.(text)) throw new Error(`failed: ${text}`);
      return { rows: [{ text }] };
    },
    release() {},
  };
  const pool: PoolLike = { connect: async () => client, end: async () => {} };
  return { pool, seen };
}

describe('a transaction runs one statement at a time', () => {
  it('queues statements started together, in the order they were started', async () => {
    const { pool, seen } = strictPool();
    const out = await dbFromPool(pool).tx((tx) =>
      Promise.all([tx.query('SELECT 1 slow'), tx.query('SELECT 2'), tx.query('SELECT 3')]),
    );
    expect(out.map((rows) => rows[0]?.text)).toEqual(['SELECT 1 slow', 'SELECT 2', 'SELECT 3']);
    expect(seen).toEqual(['BEGIN', 'SELECT 1 slow', 'SELECT 2', 'SELECT 3', 'COMMIT']);
  });

  it('lets everything queued settle before it rolls back, and still reports the failure', async () => {
    const { pool, seen } = strictPool((t) => t === 'SELECT 2');
    await expect(
      dbFromPool(pool).tx((tx) =>
        Promise.all([tx.query('SELECT 1 slow'), tx.query('SELECT 2'), tx.query('SELECT 3')]),
      ),
    ).rejects.toThrow('failed: SELECT 2');
    expect(seen.at(-1)).toBe('ROLLBACK');
    expect(seen.filter((t) => t === 'ROLLBACK')).toHaveLength(1);
    expect(seen).not.toContain('COMMIT');
  });
});
