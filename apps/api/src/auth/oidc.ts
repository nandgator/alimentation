import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { randomBytes, toBase64Url } from "../crypto/aead.ts";

/**
 * OpenID Connect, authorization-code flow with PKCE, against any compliant
 * provider. No password is ever seen here; the provider vouches for an email.
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Which claim vouches for the email. Only a deployment that chose Entra's `xms_edov` reads anything else. */
  emailVerifiedClaim?: "email_verified" | "xms_edov";
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  claims_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  prompt_values_supported?: string[];
}

export interface OidcIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
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
      `${this.cfg.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    ).then(async (r) => {
      if (!r.ok) throw new OidcError(`discovery failed (${r.status})`);
      const found = (await r.json()) as Discovery;
      // Some providers publish a document for signing in some other way (Meta's has no token endpoint), and
      // failing here says so, instead of failing later on an address that is not there.
      for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const)
        if (typeof found[key] !== "string")
          throw new OidcError(
            `the provider does not offer sign-in by authorization code (no ${key})`,
          );
      return found;
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
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.verifier))),
    );
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: f.redirectUri,
      scope: "openid email profile",
      state: f.state,
      nonce: f.nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      // Let the person choose which account to sign in with, unless the provider says it does not know how.
      ...(d.prompt_values_supported && !d.prompt_values_supported.includes("select_account")
        ? {}
        : { prompt: "select_account" }),
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
    // The secret goes in the body, as it always has, unless the provider takes it only in the header.
    const methods = d.token_endpoint_auth_methods_supported ?? [];
    const inHeader =
      methods.includes("client_secret_basic") && !methods.includes("client_secret_post");
    const form = (v: string) => new URLSearchParams({ x: v }).toString().slice(2);
    const res = await this.http(d.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        // Each half is form-encoded before the two are joined (RFC 6749, 2.3.1).
        ...(inHeader
          ? {
              authorization: `Basic ${btoa(`${form(this.cfg.clientId)}:${form(this.cfg.clientSecret)}`)}`,
            }
          : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: f.code,
        redirect_uri: f.redirectUri,
        code_verifier: f.verifier,
        ...(inHeader ? {} : { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
      }),
    });
    if (!res.ok) throw new OidcError(`the provider refused the code (${res.status})`);
    const tokens = (await res.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) throw new OidcError("the provider sent no identity token");
    this.jwks ??= createRemoteJWKSet(new URL(d.jwks_uri), {
      [Symbol.for("jose.customFetch") as never]: this.http,
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
      throw new OidcError("the identity token was issued for a different sign-in");
    if (typeof claims.sub !== "string") throw new OidcError("the provider did not share an email");

    // Microsoft Entra sends no `email_verified`. Its `xms_edov` says the address is in the person's own tenant
    // and the tenant owns the domain; it is only in the identity token, and only beside `email`. It counts
    // when the deployment has said so, and then it is the only claim that does.
    const edov = this.cfg.emailVerifiedClaim === "xms_edov";
    let email = claims.email;
    let verified = edov ? claims.xms_edov : claims.email_verified;
    let name = claims.name;
    // Some providers keep the email out of the identity token unless they are told not to (Authelia and
    // Zitadel by default). What is missing is then asked of the userinfo endpoint, which must be
    // answering about the same person.
    // A provider that says it has no such claim is not asked for it: it would only add a request that cannot help.
    const canSayVerified =
      !edov && (!d.claims_supported || d.claims_supported.includes("email_verified"));
    if (
      (typeof email !== "string" || verified === undefined) &&
      d.userinfo_endpoint &&
      tokens.access_token &&
      canSayVerified
    ) {
      const info = await this.userinfo(d.userinfo_endpoint, tokens.access_token, claims.sub);
      if (typeof email !== "string") email = info.email;
      // A verified flag counts only for the address it was given with.
      if (verified === undefined && (info.email === undefined || info.email === email))
        verified = info.email_verified;
      name ??= info.name;
    }
    if (typeof email !== "string") throw new OidcError("the provider did not share an email");
    if (verified !== true)
      throw new OidcError("the email address is not verified with the provider");
    return {
      sub: claims.sub,
      email: email.toLowerCase(),
      name: typeof name === "string" ? name : null,
    };
  }

  private async userinfo(
    endpoint: string,
    accessToken: string,
    sub: string,
  ): Promise<{ email?: string; email_verified?: unknown; name?: string }> {
    const res = await this.http(endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!res.ok) throw new OidcError(`the provider would not say who this is (${res.status})`);
    let info: Record<string, unknown>;
    try {
      info = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new OidcError("the provider answered about the person in a form that cannot be read");
    }
    // The answer must be about the person who signed in (OpenID Connect Core, 5.3.2).
    if (info.sub !== sub) throw new OidcError("the provider answered about someone else");
    return {
      email: typeof info.email === "string" ? info.email : undefined,
      email_verified: info.email_verified,
      name: typeof info.name === "string" ? info.name : undefined,
    };
  }
}
