import { buildApp, type AppDeps } from './app.ts';
import { OidcClient } from './auth/oidc.ts';
import { TokenSigner } from './auth/session.ts';
import { loadConfig, type Config } from './config.ts';
import { ControlRepo } from './control/repo.ts';
import { Keyring } from './crypto/keys.ts';
import type { Db } from './db/driver.ts';
import { Directory } from './directory.ts';
import { Gate } from './limits/gate.ts';
import { ApiError } from './workspace/errors.ts';
import type { Placement, PlacementRef, Provisioned } from './placement/types.ts';
import type { PlatformDeps } from './platform/workspaces.ts';

export interface RuntimeOptions {
  env: Record<string, string | undefined>;
  openDb: (dsn: string, opts?: { ephemeral?: boolean }) => Db;
  /** What creates workspace databases. Null on a deployment that only serves existing ones. */
  placement: Placement | null;
  now?: () => Date;
  fetch?: typeof fetch;
  log?: AppDeps['log'];
  schedule?: AppDeps['schedule'];
}

const noPlacement: Placement = {
  kind: 'external',
  async provision(): Promise<Provisioned> {
    throw new ApiError(501, 'no_placement', 'This deployment cannot create workspaces.');
  },
  async destroy(_ref: PlacementRef): Promise<void> {},
  async exists(): Promise<boolean> {
    return false;
  },
};

/** Builds the whole application from configuration and the pieces a host supplies. */
export async function createRuntime(o: RuntimeOptions) {
  const config: Config = loadConfig(o.env);
  const now = o.now ?? (() => new Date());
  const keyring = await Keyring.fromSpec(config.masterKeys);
  const control = new ControlRepo(o.openDb(config.controlDatabaseUrl));
  const gate = new Gate({
    control,
    now,
    hardCapFactor: config.hardCapFactor,
    accountDailyCap: config.capacity.accountRequestsPerDay,
    headroom: config.capacity.headroom,
    schedule: o.schedule,
  });
  const directory = new Directory({
    control,
    keyring,
    openDb: o.openDb,
    openOwnerDb: (dsn) => o.openDb(dsn, { ephemeral: true }),
    now,
    requestsLast24h: (id) => gate.today(id),
  });
  const platform: PlatformDeps = {
    control,
    keyring,
    placement: o.placement ?? noPlacement,
    openDb: o.openDb,
    directory,
    config,
    now,
  };
  const deps: AppDeps = {
    config,
    control,
    directory,
    platform,
    signer: await TokenSigner.fromSecrets(config.sessionSecrets),
    oidc: config.oidc ? new OidcClient(config.oidc, o.fetch) : null,
    gate,
    now,
    log: o.log,
    schedule: o.schedule,
  };
  return { app: buildApp(deps), deps, config };
}
