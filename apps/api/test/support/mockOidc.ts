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
    opts?: {
      audience?: string;
      nonce?: string;
      /** Claims the identity token leaves out and only the userinfo endpoint gives, as Authelia and Zitadel do by default. */
      onlyInUserinfo?: string[];
      /** Whose claims the userinfo endpoint answers with, if not the person who signed in. */
      userinfoSub?: string;
    },
  ): string;
  tokenCalls: number;
  userinfoCalls: number;
  /** How the client last proved itself at the token endpoint. */
  lastAuth: 'post' | 'basic' | undefined;
  close(): Promise<void>;
}

export interface MockOidcOptions {
  /** What discovery says the token endpoint takes. Left out, discovery says nothing, as some providers do. */
  advertise?: string[];
  /** The one way this client is registered to prove itself: another way is refused, as Authelia does. */
  registeredAs?: 'post' | 'basic';
  /** Publish a userinfo endpoint. */
  userinfo?: boolean;
  /** The prompt values discovery says are understood. Left out, discovery says nothing. */
  promptValues?: string[];
}

/** A small identity provider: discovery, keys and a token endpoint that checks PKCE. */
export async function startMockOidc(
  clientId: string,
  clientSecret: string,
  options: MockOidcOptions = {},
): Promise<MockOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<
    string,
    {
      challenge: string;
      claims: Record<string, unknown>;
      withheld: string[];
      userinfoSub: string | undefined;
      nonce: string;
      audience: string;
      used: boolean;
    }
  >();
  const accessTokens = new Map<string, { claims: Record<string, unknown>; sub: string }>();
  let issuer = '';
  const state: {
    tokenCalls: number;
    userinfoCalls: number;
    lastAuth: 'post' | 'basic' | undefined;
  } = {
    tokenCalls: 0,
    userinfoCalls: 0,
    lastAuth: undefined,
  };

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
        ...(options.userinfo ? { userinfo_endpoint: `${issuer}/userinfo` } : {}),
        ...(options.advertise ? { token_endpoint_auth_methods_supported: options.advertise } : {}),
        ...(options.promptValues ? { prompt_values_supported: options.promptValues } : {}),
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/userinfo') {
      state.userinfoCalls++;
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const known = accessTokens.get(token);
      if (!known) return json(401, { error: 'invalid_token' });
      return json(200, { sub: known.sub, ...known.claims });
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      state.tokenCalls++;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const f = new URLSearchParams(body);
        const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        let id = f.get('client_id');
        let secret = f.get('client_secret');
        let how: 'post' | 'basic' = 'post';
        if (basic) {
          how = 'basic';
          const [u, p] = Buffer.from(basic, 'base64').toString().split(':');
          // Each is form-encoded before the two are joined (RFC 6749, 2.3.1).
          id = new URLSearchParams(`x=${u ?? ''}`).get('x');
          secret = new URLSearchParams(`x=${p ?? ''}`).get('x');
          // Two ways at once is not allowed (RFC 6749, 2.3).
          if (f.has('client_secret')) return json(400, { error: 'invalid_request' });
        }
        state.lastAuth = how;
        if (options.registeredAs && options.registeredAs !== how)
          return json(401, {
            error: 'invalid_client',
            error_description: `registered for ${options.registeredAs}`,
          });
        const entry = codes.get(f.get('code') ?? '');
        if (!entry || entry.used || id !== clientId || secret !== clientSecret)
          return json(400, { error: 'invalid_grant' });
        entry.used = true;
        const challenge = createHash('sha256')
          .update(f.get('code_verifier') ?? '')
          .digest('base64url');
        if (challenge !== entry.challenge)
          return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        const inToken = Object.fromEntries(
          Object.entries(entry.claims).filter(([k]) => !entry.withheld.includes(k)),
        );
        const idToken = await new SignJWT({ ...inToken, nonce: entry.nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(entry.audience)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        const accessToken = `at-${Math.random().toString(36).slice(2)}`;
        const { sub: _sub, ...rest } = entry.claims;
        accessTokens.set(accessToken, {
          claims: rest,
          sub: entry.userinfoSub ?? String(entry.claims.sub),
        });
        return json(200, { id_token: idToken, access_token: accessToken, token_type: 'Bearer' });
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
        withheld: opts.onlyInUserinfo ?? [],
        userinfoSub: opts.userinfoSub,
        nonce: opts.nonce ?? args.nonce,
        audience: opts.audience ?? clientId,
        used: false,
      });
      return code;
    },
    get tokenCalls() {
      return state.tokenCalls;
    },
    get userinfoCalls() {
      return state.userinfoCalls;
    },
    get lastAuth() {
      return state.lastAuth;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
