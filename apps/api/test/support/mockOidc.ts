import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export interface MockOidc {
  issuer: string;
  /** What the provider would tell the app about the person who just signed in. */
  grant(
    args: { state: string; nonce: string; challenge: string },
    identity: Record<string, unknown>,
    opts?: { audience?: string; nonce?: string },
  ): string;
  tokenCalls: number;
  close(): Promise<void>;
}

/** A small identity provider: discovery, keys and a token endpoint that checks PKCE. */
export async function startMockOidc(clientId: string, clientSecret: string): Promise<MockOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<
    string,
    {
      challenge: string;
      claims: Record<string, unknown>;
      nonce: string;
      audience: string;
      used: boolean;
    }
  >();
  let issuer = '';
  const state = { tokenCalls: 0 };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      state.tokenCalls++;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const f = new URLSearchParams(body);
        const entry = codes.get(f.get('code') ?? '');
        if (
          !entry ||
          entry.used ||
          f.get('client_id') !== clientId ||
          f.get('client_secret') !== clientSecret
        )
          return json(400, { error: 'invalid_grant' });
        entry.used = true;
        const challenge = createHash('sha256')
          .update(f.get('code_verifier') ?? '')
          .digest('base64url');
        if (challenge !== entry.challenge)
          return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(entry.audience)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return json(200, { id_token: idToken, access_token: 'unused', token_type: 'Bearer' });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    grant(args, identity, opts = {}) {
      const code = `code-${codes.size + 1}-${Math.random().toString(36).slice(2)}`;
      codes.set(code, {
        challenge: args.challenge,
        claims: identity,
        nonce: opts.nonce ?? args.nonce,
        audience: opts.audience ?? clientId,
        used: false,
      });
      return code;
    },
    get tokenCalls() {
      return state.tokenCalls;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
