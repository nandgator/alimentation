import type { Limits } from '@alimentation/core';
import type { ControlRepo, WorkspaceRow } from './control/repo.ts';
import type { Bytes } from './crypto/aead.ts';
import { FieldCipher } from './crypto/fields.ts';
import {
  dsnAad,
  KeysDestroyedError,
  loadWorkspaceKeys,
  pseudonym,
  type Keyring,
  type WorkspaceKeys,
} from './crypto/keys.ts';
import type { Db } from './db/driver.ts';
import { migrate, type Migration } from './db/migrate.ts';
import { WORKSPACE_MIGRATIONS } from './db/migrations.generated.ts';
import { WorkspaceService, type WorkspaceInfo } from './workspace/service.ts';

export interface Dsns {
  app: string;
  owner: string;
}

export interface WorkspaceHandle {
  row: WorkspaceRow;
  info: WorkspaceInfo;
  /** Null once the workspace's keys are destroyed. */
  keys: WorkspaceKeys | null;
  cipher: FieldCipher | null;
  /** What logs call this workspace: unlinkable once the log key is gone. */
  logName: string;
  dsns: Dsns;
  appDb: Db;
  /** Throws when the workspace is being wiped. */
  service: WorkspaceService;
}

export interface DirectoryDeps {
  control: ControlRepo;
  keyring: Keyring;
  openDb: (dsn: string) => Db;
  now: () => Date;
  requestsLast24h: (workspaceId: string) => Promise<number>;
  /** How long a workspace's details are trusted before the control database is asked again. */
  ttlMs?: number;
  /** The schema this release expects. A workspace that is behind is migrated when first used. */
  migrations?: readonly Migration[];
  openOwnerDb?: (dsn: string) => Db;
}

export async function readDsns(keyring: Keyring, id: string, dsnEnc: Bytes): Promise<Dsns> {
  return JSON.parse(new TextDecoder().decode(await keyring.unwrap(dsnEnc, dsnAad(id)))) as Dsns;
}

export async function sealDsns(keyring: Keyring, id: string, dsns: Dsns): Promise<Bytes> {
  return keyring.wrap(new TextEncoder().encode(JSON.stringify(dsns)), dsnAad(id));
}

/**
 * Finds a workspace by its address and gives back what is needed to serve it: its
 * database, its keys and its service. The answer is cached briefly, so the control
 * database is not asked on every request; the cost is that a state change (a wipe,
 * a move) reaches every running instance within `ttlMs`, 60 seconds by default.
 */
export class Directory {
  private readonly cache = new Map<string, { at: number; handle: WorkspaceHandle }>();
  constructor(private readonly d: DirectoryDeps) {}

  private fresh(entry: { at: number }): boolean {
    return this.d.now().getTime() - entry.at < (this.d.ttlMs ?? 60_000);
  }

  async bySlug(slug: string): Promise<WorkspaceHandle | undefined> {
    const hit = this.cache.get(slug);
    if (hit && this.fresh(hit)) return hit.handle;
    const row = await this.d.control.workspaceBySlug(slug);
    if (!row) {
      this.cache.delete(slug);
      return undefined;
    }
    return this.build(row);
  }

  async byId(id: string): Promise<WorkspaceHandle | undefined> {
    const row = await this.d.control.workspaceById(id);
    return row && this.build(row);
  }

  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  /**
   * Brings an older workspace database up to this release's schema, under the
   * migration lock, so two instances meeting it at once apply each step once.
   * Releases keep to expand-and-contract, so an instance that has not yet been
   * upgraded still works against the newer schema.
   */
  private async ensureSchema(dsns: Dsns, appDb: Db): Promise<void> {
    const wanted = (this.d.migrations ?? WORKSPACE_MIGRATIONS).length;
    const have = await appDb.tx(async (tx) =>
      Number((await tx.query<{ v: number }>('SELECT schema_version() AS v'))[0]!.v),
    );
    if (have >= wanted || !this.d.openOwnerDb) return;
    const owner = this.d.openOwnerDb(dsns.owner);
    try {
      const role = (
        await owner.tx(async (tx) =>
          tx.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'app_role'`),
        )
      )[0]!.value;
      await owner.withClient((client) =>
        migrate(client, this.d.migrations ?? WORKSPACE_MIGRATIONS, {
          settings: { 'alimentation.app_role': role },
        }),
      );
    } finally {
      await owner.close();
    }
  }

  private async build(row: WorkspaceRow): Promise<WorkspaceHandle> {
    const dsns = await readDsns(this.d.keyring, row.id, row.dsnEnc);
    let keys: WorkspaceKeys | null = null;
    try {
      keys = await loadWorkspaceKeys(this.d.keyring, row.id, row);
    } catch (e) {
      if (!(e instanceof KeysDestroyedError)) throw e;
    }
    const appDb = this.d.openDb(dsns.app);
    if (row.state === 'ACTIVE') await this.ensureSchema(dsns, appDb);
    const cipher = keys ? new FieldCipher(keys) : null;
    const info: WorkspaceInfo = {
      id: row.id,
      slug: row.slug,
      name: row.displayName,
      timeZone: row.timeZone,
      currency: 'INR',
      state: row.state === 'WIPING' ? 'MOVED' : row.state,
      movedTo: row.movedToUrl,
      limits: row.limits as Limits,
      overSince: row.overSince,
    };
    const { control, now, requestsLast24h } = this.d;
    let service: WorkspaceService | undefined;
    const handle: WorkspaceHandle = {
      row,
      info,
      keys,
      cipher,
      logName: keys ? await pseudonym(keys, row.id) : 'wiped',
      dsns,
      appDb,
      get service(): WorkspaceService {
        if (!cipher) throw new KeysDestroyedError();
        service ??= new WorkspaceService({
          db: appDb,
          cipher,
          info,
          now,
          requestsLast24h: () => requestsLast24h(row.id),
          recordOverSince: async (date) => {
            info.overSince = date;
            await control.setOverSince(row.id, date);
          },
        });
        return service;
      },
    };
    this.cache.set(row.slug, { at: this.d.now().getTime(), handle });
    return handle;
  }
}
