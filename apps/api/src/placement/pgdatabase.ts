import pg from 'pg';
import { migrate, type Migration } from '../db/migrate.ts';
import {
  randomSecret,
  type Credentials,
  type Placement,
  type PlacementRef,
  type Provisioned,
} from './types.ts';

export interface PgDatabaseOptions {
  /** Superuser, or a role that can create roles and databases. */
  adminUrl: string;
  /** Names the database and roles `<prefix>_<id>`. Workspaces use `ws`. */
  prefix?: string;
  connectionLimit?: number;
  statementTimeout?: string;
  lockTimeout?: string;
  idleInTransactionTimeout?: string;
}

/**
 * A database and two roles inside a shared Postgres cluster. Isolation is by
 * database and credentials, and the application role carries a connection limit
 * and a statement timeout so that one workspace cannot hold the cluster.
 */
export class PgDatabasePlacement implements Placement {
  readonly kind = 'pg-database' as const;
  constructor(private readonly opts: PgDatabaseOptions) {}

  private names(workspaceId: string) {
    const short = workspaceId.replace(/-/g, '').slice(0, 16).toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(short)) throw new Error('workspace id must be a UUID');
    const pre = this.opts.prefix ?? 'ws';
    return {
      database: `${pre}_${short}`,
      owner: `${pre}_${short}_own`,
      app: `${pre}_${short}_app`,
    };
  }

  private withUser(urlText: string, user: string, password: string, database: string): string {
    const u = new URL(urlText);
    u.username = user;
    u.password = password;
    u.pathname = `/${database}`;
    return u.toString();
  }

  async provision(workspaceId: string, migrations: readonly Migration[]): Promise<Provisioned> {
    const n = this.names(workspaceId);
    const ownerPassword = randomSecret();
    const appPassword = randomSecret();
    const admin = new pg.Client({ connectionString: this.opts.adminUrl });
    await admin.connect();
    try {
      // format() quotes identifiers and literals on the server, so nothing here is spliced by hand.
      const run = async (template: string, ...args: string[]) => {
        const r = await admin.query('SELECT format($1, VARIADIC $2::text[]) AS q', [
          template,
          args,
        ]);
        await admin.query(String(r.rows[0]!.q));
      };
      const limit = String(Math.trunc(Number(this.opts.connectionLimit ?? 10)));
      await run(
        'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
        n.owner,
        ownerPassword,
      );
      await run(
        'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT %s',
        n.app,
        appPassword,
        limit,
      );
      await run('CREATE DATABASE %I OWNER %I', n.database, n.owner);
      await run('REVOKE ALL ON DATABASE %I FROM PUBLIC', n.database);
      await run('GRANT CONNECT ON DATABASE %I TO %I', n.database, n.app);
      const settings: [string, string][] = [
        ['statement_timeout', this.opts.statementTimeout ?? '5s'],
        ['lock_timeout', this.opts.lockTimeout ?? '2s'],
        ['idle_in_transaction_session_timeout', this.opts.idleInTransactionTimeout ?? '10s'],
      ];
      for (const [k, v] of settings)
        await run('ALTER ROLE %I IN DATABASE %I SET %s = %L', n.app, n.database, k, v);

      const ownerUrl = this.withUser(this.opts.adminUrl, n.owner, ownerPassword, n.database);
      const owner = new pg.Client({ connectionString: ownerUrl });
      await owner.connect();
      try {
        await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
        await migrate(owner, migrations, { settings: { 'alimentation.app_role': n.app } });
      } finally {
        await owner.end();
      }
      return {
        ref: { kind: 'pg-database', data: { database: n.database, owner: n.owner, app: n.app } },
        ownerUrl,
        appUrl: this.withUser(this.opts.adminUrl, n.app, appPassword, n.database),
      };
    } catch (e) {
      await this.destroy({
        kind: 'pg-database',
        data: { database: n.database, owner: n.owner, app: n.app },
      }).catch(() => undefined);
      throw e;
    } finally {
      await admin.end();
    }
  }

  async destroy(ref: PlacementRef, _creds?: Credentials): Promise<void> {
    const { database, owner, app } = ref.data as Record<string, string>;
    if (!database || !owner || !app) throw new Error('not a pg-database reference');
    const admin = new pg.Client({ connectionString: this.opts.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [database],
      );
      const drop = async (template: string, ident: string) => {
        const r = await admin.query('SELECT format($1, VARIADIC $2::text[]) AS q', [
          template,
          [ident],
        ]);
        await admin.query(String(r.rows[0]!.q));
      };
      await drop('DROP DATABASE IF EXISTS %I WITH (FORCE)', database);
      await drop('DROP ROLE IF EXISTS %I', app);
      await drop('DROP ROLE IF EXISTS %I', owner);
    } finally {
      await admin.end();
    }
  }

  /**
   * Postgres lets every role connect to every database unless told otherwise, so a
   * workspace's application role could open the cluster's other databases. This
   * removes that default for one database. The placement already does it for each
   * workspace it creates; an operator runs `lockDownOthers` once for the databases
   * that were there before. Use a cluster that is dedicated to workspaces.
   */
  async lockDown(database: string): Promise<void> {
    const admin = new pg.Client({ connectionString: this.opts.adminUrl });
    await admin.connect();
    try {
      const r = await admin.query('SELECT format($1, VARIADIC $2::text[]) AS q', [
        'REVOKE CONNECT ON DATABASE %I FROM PUBLIC',
        [database],
      ]);
      await admin.query(String(r.rows[0]!.q));
    } finally {
      await admin.end();
    }
  }

  /** Locks down every database that is not a workspace and not in `keep`. Returns the ones it changed. */
  async lockDownOthers(keep: readonly string[] = []): Promise<string[]> {
    const admin = new pg.Client({ connectionString: this.opts.adminUrl });
    await admin.connect();
    let names: string[];
    try {
      const r = await admin.query(
        `SELECT datname FROM pg_database WHERE datname NOT LIKE 'ws\\_%' AND datallowconn`,
      );
      names = r.rows.map((x) => String(x.datname)).filter((n) => !keep.includes(n));
    } finally {
      await admin.end();
    }
    for (const n of names) await this.lockDown(n);
    return names;
  }

  async exists(ref: PlacementRef, _creds?: Credentials): Promise<boolean> {
    const { database } = ref.data as Record<string, string>;
    const admin = new pg.Client({ connectionString: this.opts.adminUrl });
    await admin.connect();
    try {
      const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      return r.rows.length > 0;
    } finally {
      await admin.end();
    }
  }
}
