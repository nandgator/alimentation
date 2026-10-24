import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { randomBytes, toBase64Url } from '../crypto/aead.ts';

/**
 * OpenID Connect, authorization-code flow with PKCE, against any compliant
 * provider. No password is ever seen here; the provider vouches for an email.
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

export class OidcClient {
  private disc: Promise<Discovery> | undefined;
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(
    private readonly cfg: OidcConfig,
    private readonly http: typeof fetch = fetch,
  ) {}

  private discover(): Promise<Discovery> {
    this.disc ??= this.http(
      `${this.cfg.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
    ).then(async (r) => {
      if (!r.ok) throw new OidcError(`discovery failed (${r.status})`);
      return (await r.json()) as Discovery;
    });
    this.disc.catch(() => {
      this.disc = undefined;
    });
    return this.disc;
  }

  static newFlow(): { state: string; nonce: string; verifier: string } {
    return {
      state: toBase64Url(randomBytes(16)),
      nonce: toBase64Url(randomBytes(16)),
      verifier: toBase64Url(randomBytes(32)),
    };
  }

  async authorizeUrl(f: {
    redirectUri: string;
    state: string;
    nonce: string;
    verifier: string;
  }): Promise<string> {
    const d = await this.discover();
    const challenge = toBase64Url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.verifier))),
    );
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: f.redirectUri,
      scope: 'openid email profile',
      state: f.state,
      nonce: f.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  async exchange(f: {
    code: string;
    verifier: string;
    redirectUri: string;
    nonce: string;
  }): Promise<OidcIdentity> {
    const d = await this.discover();
    const res = await this.http(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: f.code,
        redirect_uri: f.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code_verifier: f.verifier,
      }),
    });
    if (!res.ok) throw new OidcError(`the provider refused the code (${res.status})`);
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) throw new OidcError('the provider sent no identity token');
    this.jwks ??= createRemoteJWKSet(new URL(d.jwks_uri), {
      [Symbol.for('jose.customFetch') as never]: this.http,
    } as never);
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: d.issuer,
        audience: this.cfg.clientId,
      }));
    } catch (e) {
      throw new OidcError(`the identity token did not verify: ${(e as Error).message}`);
    }
    if (claims.nonce !== f.nonce)
      throw new OidcError('the identity token was issued for a different sign-in');
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string')
      throw new OidcError('the provider did not share an email');
    if (claims.email_verified !== true)
      throw new OidcError('the email address is not verified with the provider');
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }
}
