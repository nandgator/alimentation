import { loadConfig } from './config.ts';
import { ControlRepo } from './control/repo.ts';
import { nodeDb } from './db/node.ts';
import { migrate } from './db/migrate.ts';
import { CONTROL_MIGRATIONS, WORKSPACE_MIGRATIONS } from './db/migrations.generated.ts';
import { readDsns } from './directory.ts';
import { Keyring } from './crypto/keys.ts';
import { PgDatabasePlacement } from './placement/pgdatabase.ts';
import { randomBytes, randomUUID } from 'node:crypto';

/**
 *   keys:generate     print a new MASTER_KEYS and SESSION_SECRETS
 *   control:init      create the control database and print the settings that point at it
 *   migrate:control   bring the control database up to this release
 *   migrate:all       bring every workspace database up to this release
 *   lockdown          stop the other databases on the workspace cluster being open to everyone
 */
const [command] = process.argv.slice(2);
const env = process.env;
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is required for ${command}`);
  return v;
};

switch (command) {
  case 'control:init': {
    const placement = new PgDatabasePlacement({
      adminUrl: need('PLACEMENT_ADMIN_URL'),
      prefix: 'control',
    });
    const p = await placement.provision(randomUUID(), CONTROL_MIGRATIONS);
    console.log(`CONTROL_DATABASE_URL=${p.appUrl}`);
    console.log(
      `CONTROL_OWNER_URL=${p.ownerUrl}   # keep this for migrate:control; the app does not need it`,
    );
    break;
  }
  case 'keys:generate': {
    console.log(`MASTER_KEYS=${(await Keyring.generate()).spec}`);
    console.log(`SESSION_SECRETS=${randomBytes(32).toString('base64')}`);
    break;
  }
  case 'migrate:control': {
    const db = nodeDb(need('CONTROL_OWNER_URL'), { max: 1 });
    try {
      const role = new URL(need('CONTROL_DATABASE_URL')).username;
      const r = await db.withClient((c) =>
        migrate(c, CONTROL_MIGRATIONS, { settings: { 'alimentation.app_role': role } }),
      );
      console.log(JSON.stringify(r));
    } finally {
      await db.close();
    }
    break;
  }
  case 'migrate:all': {
    const config = loadConfig(env);
    const keyring = await Keyring.fromSpec(config.masterKeys);
    const control = new ControlRepo(nodeDb(config.controlDatabaseUrl, { max: 2 }));
    let failed = 0;
    for (const w of await control.allWorkspaces()) {
      if (w.state === 'WIPING') continue;
      const dsns = await readDsns(keyring, w.id, w.dsnEnc);
      const db = nodeDb(dsns.owner, { max: 1 });
      try {
        const role = (
          await db.tx(async (tx) =>
            tx.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'app_role'`),
          )
        )[0]!.value;
        const r = await db.withClient((c) =>
          migrate(c, WORKSPACE_MIGRATIONS, { settings: { 'alimentation.app_role': role } }),
        );
        console.log(JSON.stringify({ workspace: w.id, ...r }));
      } catch (e) {
        failed++;
        console.error(JSON.stringify({ workspace: w.id, error: (e as Error).message }));
      } finally {
        await db.close();
      }
    }
    process.exitCode = failed ? 1 : 0;
    break;
  }
  case 'lockdown': {
    const placement = new PgDatabasePlacement({ adminUrl: need('PLACEMENT_ADMIN_URL') });
    console.log(
      JSON.stringify({ lockedDown: await placement.lockDownOthers(process.argv.slice(3)) }),
    );
    break;
  }
  default:
    console.error(
      'usage: cli.ts keys:generate | control:init | migrate:control | migrate:all | lockdown [database ...]',
    );
    process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);
