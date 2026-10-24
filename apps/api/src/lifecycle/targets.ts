/**
 * A person types the address of the place their workspace should go, and this
 * server then connects to it. Anything that would let that reach into our own
 * network is refused before a connection is made. In development, where the
 * target is often on the same machine, only the scheme is checked.
 */

// Not `node:net`: this file also runs on Workers.
const ipKind = (h: string): 0 | 4 | 6 =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ? 4 : h.includes(':') && /^[0-9a-f:.]+$/.test(h) ? 6 : 0;

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^22[4-9]\.|^2[3-5]\d\./,
];

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  )
    return true;
  if (!h.includes('.') && ipKind(h) === 0) return true; // a bare name only resolves inside a network
  const kind = ipKind(h);
  if (kind === 4) return PRIVATE_V4.some((re) => re.test(h));
  if (kind === 6) {
    return (
      h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^::ffff:/.test(h) // an IPv4 address in disguise
    );
  }
  return false;
}

/** Returns what is wrong with a target address, or null when it can be used. */
export function targetProblem(
  text: string,
  kind: 'database' | 'instance',
  production: boolean,
): string | null {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return kind === 'database'
      ? 'That is not a Postgres connection string (postgres://user:password@host/database).'
      : 'That is not a web address (https://…).';
  }
  if (kind === 'database') {
    if (!/^postgres(ql)?:$/.test(u.protocol))
      return 'That is not a Postgres connection string (postgres://user:password@host/database).';
  } else if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !production)) {
    return 'The address of your own instance must start with https://.';
  }
  if (!production) return null;
  if (isPrivateHost(u.hostname))
    return 'That address points inside a private network, which this service cannot reach.';
  if (kind === 'database') {
    const mode = u.searchParams.get('sslmode');
    if (!mode || !['require', 'verify-ca', 'verify-full'].includes(mode))
      return 'Add ?sslmode=require to the connection string, so your data travels encrypted.';
  }
  return null;
}
