import type { Db } from '../db/driver.ts';
import type { Migration } from '../db/migrate.ts';
import { ApiError } from '../workspace/errors.ts';
import { prepareExternalTarget } from './external.ts';
import type { Credentials, Placement, PlacementRef, Provisioned } from './types.ts';

/**
 * One Neon project per workspace, made and removed through Neon's API.
 *
 * A project is the unit Neon meters, caps and deletes, so a workspace that uses its
 * whole share suspends only itself, and removing it is one call. The owner role is the
 * one Neon makes with the project. The application role is made with SQL, not with the
 * API: roles made through the API join `neon_superuser`, which bypasses row-level
 * security, and the isolation between people in a workspace depends on that not being so.
 *
 * Point-in-time history is switched off for these projects, so a restore cannot bring
 * back data after the keys that open it were destroyed.
 */

export interface NeonOptions {
  apiKey: string;
  /** For example `aws-ap-southeast-1`. */
  regionId: string;
  /** Needed only for an organisation's API key. */
  orgId?: string;
  openDb: (dsn: string, o?: { ephemeral?: boolean }) => Db;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Per-project caps Neon enforces by suspending that project's compute. */
  quota?: Partial<
    Record<
      | 'logical_size_bytes'
      | 'compute_time_seconds'
      | 'active_time_seconds'
      | 'written_data_bytes'
      | 'data_transfer_bytes',
      number
    >
  >;
  /** Seconds of history to keep. Zero keeps none. */
  historyRetentionSeconds?: number;
  pgVersion?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Hears what went wrong, for the operator's log. Never contains the key. */
  onError?: (detail: string) => void;
}

interface Operation {
  id: string;
  status: string;
  error?: string;
}

interface CreatedProject {
  project: { id: string };
  branch: { id: string };
  connection_uris: { connection_uri: string }[];
  operations?: Operation[];
}

class NeonError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NeonError';
  }
}

const TERMINAL_OK = new Set(['finished', 'skipped']);
const TERMINAL_BAD = new Set(['failed', 'error', 'cancelled']);

export class NeonPlacement implements Placement {
  readonly kind = 'neon-project' as const;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: NeonOptions) {
    this.base = (o.baseUrl ?? 'https://console.neon.tech/api/v2').replace(/\/+$/, '');
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One call to Neon, retried when Neon asks us to slow down. Never puts the key in a message. */
  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(`${this.base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.o.apiKey}`,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new NeonError(0, 'could not reach the database host');
      }
      if ((res.status === 429 || res.status === 423) && attempt < 4) {
        const wait = Number(res.headers.get('retry-after'));
        await this.sleep(
          Math.min(10_000, (Number.isFinite(wait) && wait > 0 ? wait : 1 + attempt) * 1000),
        );
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = '';
        try {
          detail = String((JSON.parse(text) as { message?: string }).message ?? '');
        } catch {
          detail = '';
        }
        throw new NeonError(res.status, detail.slice(0, 200) || `status ${res.status}`);
      }
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  private async settle(projectId: string, ops: Operation[] = []): Promise<void> {
    for (const first of ops) {
      let op = first;
      for (let i = 0; !TERMINAL_OK.has(op.status); i++) {
        if (TERMINAL_BAD.has(op.status))
          throw new NeonError(
            0,
            `a step failed while making the project: ${op.error ?? op.status}`,
          );
        if (i >= 120) throw new NeonError(0, 'making the project took too long');
        await this.sleep(500);
        op = (
          await this.api<{ operation: Operation }>(
            'GET',
            `/projects/${projectId}/operations/${op.id}`,
          )
        ).operation;
      }
    }
  }

  /** The migrations are the ones built into this release, which `prepareExternalTarget` applies. */
  async provision(workspaceId: string, _migrations?: readonly Migration[]): Promise<Provisioned> {
    const project: Record<string, unknown> = {
      name: `alim-${workspaceId.slice(0, 8)}`,
      region_id: this.o.regionId,
      pg_version: this.o.pgVersion ?? 18,
      store_passwords: true,
      history_retention_seconds: this.o.historyRetentionSeconds ?? 0,
      branch: { role_name: 'owner', database_name: 'workspace' },
      ...(this.o.orgId ? { org_id: this.o.orgId } : {}),
      ...(this.o.quota && Object.keys(this.o.quota).length
        ? { settings: { quota: this.o.quota } }
        : {}),
    };

    let created: CreatedProject;
    try {
      created = await this.api<CreatedProject>('POST', '/projects', { project });
    } catch (e) {
      this.report(e);
      throw unavailable(e);
    }
    const ref: PlacementRef = {
      kind: 'neon-project',
      data: { projectId: created.project.id, branchId: created.branch.id },
    };
    try {
      await this.settle(created.project.id, created.operations);
      const ownerUrl = created.connection_uris[0]?.connection_uri;
      if (!ownerUrl) throw new NeonError(0, 'no connection was returned for the new project');
      const prepared = await prepareExternalTarget(this.o.openDb, ownerUrl);
      if (!prepared.ok || !prepared.appUrl)
        throw new NeonError(
          0,
          prepared.problems.join(' ') || 'the new database could not be prepared',
        );
      return { ref, ownerUrl, appUrl: prepared.appUrl };
    } catch (e) {
      // Do not leave a project we cannot reach behind: it would count against the free allowance.
      await this.destroy(ref).catch(() => undefined);
      this.report(e);
      throw unavailable(e);
    }
  }

  private report(e: unknown): void {
    if (e instanceof ApiError) return;
    this.o.onError?.(
      e instanceof NeonError
        ? `neon ${e.status}: ${e.message}`
        : String((e as Error)?.message ?? e).slice(0, 200),
    );
  }

  async destroy(ref: PlacementRef, _creds?: Credentials): Promise<void> {
    const id = ref.data.projectId;
    if (!id) return;
    try {
      await this.api('DELETE', `/projects/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof NeonError && e.status === 404) return;
      throw e;
    }
  }

  async exists(ref: PlacementRef, _creds?: Credentials): Promise<boolean> {
    const id = ref.data.projectId;
    if (!id) return false;
    try {
      await this.api('GET', `/projects/${encodeURIComponent(id)}`);
      return true;
    } catch (e) {
      if (e instanceof NeonError && e.status === 404) return false;
      throw e;
    }
  }
}

const unavailable = (e: unknown) =>
  e instanceof ApiError
    ? e
    : new ApiError(
        503,
        'placement_unavailable',
        'The database for a new workspace could not be made just now. Nothing was created; try again in a minute.',
      );
