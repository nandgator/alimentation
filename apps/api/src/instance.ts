import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Keyring } from './crypto/keys.ts';
import { migrate } from './db/migrate.ts';
import { CONTROL_MIGRATIONS } from './db/migrations.generated.ts';
import { nodeDb } from './db/node.ts';
import { PgDatabasePlacement } from './placement/pgdatabase.ts';

interface Saved {
  SESSION_SECRETS: string;
  MASTER_KEYS: string;
  CONTROL_DATABASE_URL: string;
  CONTROL_OWNER_URL: string;
}

type Env = Record<string, string | undefined>;

/**
 * Lets an instance set itself up: the one-command start of a dedicated deployment.
 *
 * When `INSTANCE_DIR` and `PLACEMENT_ADMIN_URL` are set and the secrets are not,
 * the first start makes the control database and the keys and keeps them in
 * `instance.json` in that directory (readable by the server only). Every later start
 * reads them back and brings the control database up to date. Anything given
 * explicitly in the environment wins, so a host that injects its own secrets is
 * unaffected.
 *
 * One instance at a time: two servers starting for the very first time together would
 * each make a control database.
 */
export async function selfHost(env: Env): Promise<Env> {
  const dir = env.INSTANCE_DIR;
  const admin = env.PLACEMENT_ADMIN_URL;
  if (!dir || !admin) return env;
  if (env.MASTER_KEYS && env.SESSION_SECRETS && env.CONTROL_DATABASE_URL) return env;

  const file = join(dir, 'instance.json');
  let saved: Saved | null = null;
  try {
    saved = JSON.parse(await readFile(file, 'utf8')) as Saved;
  } catch {
    saved = null;
  }

  if (!saved) {
    await mkdir(dir, { recursive: true });
    const placement = new PgDatabasePlacement({ adminUrl: admin, prefix: 'control' });
    const control = await placement.provision(randomUUID(), CONTROL_MIGRATIONS);
    saved = {
      SESSION_SECRETS: randomBytes(32).toString('base64'),
      MASTER_KEYS: (await Keyring.generate()).spec,
      CONTROL_DATABASE_URL: control.appUrl,
      CONTROL_OWNER_URL: control.ownerUrl,
    };
    await writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  } else {
    const db = nodeDb(saved.CONTROL_OWNER_URL, { max: 1 });
    try {
      const role = new URL(saved.CONTROL_DATABASE_URL).username;
      await db.withClient((c) =>
        migrate(c, CONTROL_MIGRATIONS, { settings: { 'alimentation.app_role': role } }),
      );
    } finally {
      await db.close();
    }
  }
  const { CONTROL_OWNER_URL: _owner, ...forApp } = saved;
  // An empty value (a compose file passing through an unset variable) is not a choice.
  return { ...forApp, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v)) };
}
