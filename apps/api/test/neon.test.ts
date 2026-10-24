import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeOpenDb } from '../src/db/node.ts';
import { NeonPlacement, type NeonOptions } from '../src/placement/neon.ts';
import { ApiError } from '../src/workspace/errors.ts';
import { ADMIN_URL } from './support/pg.ts';

/**
 * A stand-in for Neon's API that keeps each "project" as a real database on the test
 * server, so what runs against it afterwards (the role, the migrations, the isolation)
 * is real. It records every call it gets.
 */
function fakeNeon() {
  const projects = new Map<string, { database: string; owner: string }>();
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const control = {
    createStatus: 201,
    rateLimitFirst: 0,
    operationFails: false,
    deleteStatus: 200,
  };
  const admin = async <T>(fn: (c: pg.Client) => Promise<T>) => {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  let polled = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/api/v2', '');
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: headers.get('authorization') });

    if (method === 'POST' && path === '/projects') {
      if (control.rateLimitFirst > 0) {
        control.rateLimitFirst--;
        return json(429, { message: 'slow down' }, { 'retry-after': '0' });
      }
      if (control.createStatus !== 201)
        return json(control.createStatus, { message: 'quota exceeded for this plan' });
      const id = `proj-${randomBytes(4).toString('hex')}`;
      const database = `neon_${randomBytes(4).toString('hex')}`;
      const owner = `owner_${randomBytes(4).toString('hex')}`;
      const password = randomBytes(12).toString('hex');
      await admin(async (c) => {
        await c.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${password}' CREATEROLE NOSUPERUSER`);
        await c.query(`CREATE DATABASE ${database} OWNER ${owner}`);
      });
      projects.set(id, { database, owner });
      const u = new URL(ADMIN_URL);
      u.username = owner;
      u.password = password;
      u.pathname = `/${database}`;
      return json(201, {
        project: { id },
        branch: { id: 'br-main' },
        connection_uris: [{ connection_uri: u.toString() }],
        operations: [{ id: 'op-1', status: 'running' }],
      });
    }
    const op = /^\/projects\/([^/]+)\/operations\/([^/]+)$/.exec(path);
    if (method === 'GET' && op) {
      polled++;
      return json(200, {
        operation: {
          id: op[2],
          status: control.operationFails ? 'failed' : 'finished',
          error: 'boom',
        },
      });
    }
    const one = /^\/projects\/([^/]+)$/.exec(path);
    if (one) {
      const known = projects.get(one[1]!);
      if (method === 'GET')
        return known
          ? json(200, { project: { id: one[1] } })
          : json(404, { message: 'project not found' });
      if (method === 'DELETE') {
        if (control.deleteStatus !== 200) return json(control.deleteStatus, { message: 'nope' });
        if (!known) return json(404, { message: 'project not found' });
        await admin(async (c) => {
          await c.query(`DROP DATABASE IF EXISTS ${known.database} WITH (FORCE)`);
          await c.query(`DROP ROLE IF EXISTS ${known.owner}`);
        });
        projects.delete(one[1]!);
        return json(200, { project: { id: one[1] } });
      }
    }
    return json(404, { message: 'no such route' });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    projects,
    calls,
    control,
    polls: () => polled,
    async cleanup() {
      for (const p of projects.values())
        await admin(async (c) => {
          await c.query(`DROP DATABASE IF EXISTS ${p.database} WITH (FORCE)`);
          const roles = await c.query(
            `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alim\\_app\\_%' OR rolname = $1`,
            [p.owner],
          );
          for (const r of roles.rows)
            await c.query(`DROP ROLE IF EXISTS "${r.rolname}"`).catch(() => undefined);
        });
    },
  };
}

describe('[P1] a workspace on its own Neon project', () => {
  const neon = fakeNeon();
  const openDb = nodeOpenDb();
  const errors: string[] = [];
  const placement = (extra: Partial<NeonOptions> = {}) =>
    new NeonPlacement({
      apiKey: 'napi_SECRETKEY123',
      regionId: 'aws-ap-southeast-1',
      openDb,
      fetch: neon.fetch,
      sleep: async () => undefined,
      onError: (d) => errors.push(d),
      ...extra,
    });
  afterAll(async () => {
    await openDb.closeAll();
    await neon.cleanup();
  });

  it('makes a project with no history to restore from, then a role that row-level security applies to', async () => {
    const p = placement({ quota: { logical_size_bytes: 123_456 } });
    const made = await p.provision(randomUUID(), []);
    expect(made.ref.kind).toBe('neon-project');
    expect(made.ref.data.projectId).toMatch(/^proj-/);

    const create = neon.calls.find((c) => c.method === 'POST' && c.path === '/projects')!;
    expect(create.auth).toBe('Bearer napi_SECRETKEY123');
    expect(create.body).toMatchObject({
      project: {
        region_id: 'aws-ap-southeast-1',
        pg_version: 18,
        history_retention_seconds: 0,
        settings: { quota: { logical_size_bytes: 123_456 } },
      },
    });
    expect((create.body as { project: Record<string, unknown> }).project.org_id).toBeUndefined();
    expect(neon.polls()).toBeGreaterThan(0); // waited for Neon to finish

    const owner = new pg.Client({ connectionString: made.ownerUrl });
    await owner.connect();
    const tables = await owner.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'person'`,
    );
    expect(tables.rows[0].n).toBe(1);
    const role = await owner.query(
      `SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = $1`,
      [new URL(made.appUrl).username],
    );
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false });
    await owner.end();

    const app = new pg.Client({ connectionString: made.appUrl });
    await app.connect();
    expect((await app.query(`SELECT count(*)::int AS n FROM person`)).rows[0].n).toBe(0);
    await app.end();

    await p.destroy(made.ref);
    expect(await p.exists(made.ref)).toBe(false);
  });

  it('sends the organisation when there is one', async () => {
    const p = placement({ orgId: 'org-123' });
    const made = await p.provision(randomUUID(), []);
    const create = neon.calls.filter((c) => c.path === '/projects' && c.method === 'POST').at(-1)!;
    expect((create.body as { project: { org_id: string } }).project.org_id).toBe('org-123');
    await p.destroy(made.ref);
  });

  it('waits out a request limit and carries on', async () => {
    neon.control.rateLimitFirst = 2;
    const p = placement();
    const made = await p.provision(randomUUID(), []);
    await p.destroy(made.ref);
    expect(neon.control.rateLimitFirst).toBe(0);
  });

  it('removes the project, and answers the same when asked again', async () => {
    const p = placement();
    const made = await p.provision(randomUUID(), []);
    expect(await p.exists(made.ref)).toBe(true);
    await p.destroy(made.ref);
    expect(await p.exists(made.ref)).toBe(false);
    await expect(p.destroy(made.ref)).resolves.toBeUndefined();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    expect(
      (
        await a.query(`SELECT 1 FROM pg_database WHERE datname LIKE 'neon\\_%' AND datname = $1`, [
          new URL(made.ownerUrl).pathname.slice(1),
        ])
      ).rowCount,
    ).toBe(0);
    await a.end();
  });

  it('refuses to say a delete worked when Neon said otherwise', async () => {
    const p = placement();
    const made = await p.provision(randomUUID(), []);
    neon.control.deleteStatus = 500;
    await expect(p.destroy(made.ref)).rejects.toThrow();
    neon.control.deleteStatus = 200;
    expect(await p.exists(made.ref)).toBe(true);
    await p.destroy(made.ref);
  });

  it('says plainly that it could not make one, leaves nothing behind, and keeps the key out of what it says', async () => {
    neon.control.createStatus = 403;
    const before = neon.projects.size;
    const err = await placement()
      .provision(randomUUID(), [])
      .catch((e) => e);
    neon.control.createStatus = 201;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('placement_unavailable');
    expect(neon.projects.size).toBe(before);
    expect(errors.at(-1)).toContain('neon 403');
    expect(errors.join(' ') + err.message).not.toContain('SECRETKEY');
  });

  it('deletes the project it just made when a later step fails', async () => {
    neon.control.operationFails = true;
    const before = neon.projects.size;
    const err = await placement()
      .provision(randomUUID(), [])
      .catch((e) => e);
    neon.control.operationFails = false;
    expect(err).toBeInstanceOf(ApiError);
    expect(neon.projects.size).toBe(before);
    expect(errors.at(-1)).toContain('a step failed');
  });

  it('does not reach Neon at all when it cannot be reached', async () => {
    const down = placement({
      fetch: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    const err = await down.provision(randomUUID(), []).catch((e) => e);
    expect(err.status).toBe(503);
  });
});
