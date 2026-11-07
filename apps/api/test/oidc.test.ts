import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OidcClient } from "../src/auth/oidc.ts";
import { TokenSigner } from "../src/auth/session.ts";
import { loadConfig } from "../src/config.ts";
import { randomBytes } from "../src/crypto/aead.ts";
import { type MockOidc, type MockOidcOptions, startMockOidc } from "./support/mockOidc.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";

const b64 = () => Buffer.from(randomBytes(32)).toString("base64");

describe("signing in through an identity provider", () => {
  let idp: MockOidc;
  let p: TestPlatform;
  beforeAll(async () => {
    idp = await startMockOidc("client-1", "secret-1");
    p = await makePlatform(
      {
        OIDC_ISSUER: idp.issuer,
        OIDC_CLIENT_ID: "client-1",
        OIDC_CLIENT_SECRET: "secret-1",
        AUTH_DEV: "0",
      },
      { devAuth: false },
    );
    // makePlatform points OIDC at a dead port when devAuth is false; point it at the mock instead.
  });
  afterAll(async () => {
    await p.destroy();
    await idp.close();
  });

  /** Runs the browser's half: follow the redirect, let the provider approve, come back with the code. */
  async function signIn(
    identity: Record<string, unknown>,
    tweak: { state?: string; nonce?: string; audience?: string; dropFlowCookie?: boolean } = {},
  ) {
    const start = await p.runtime.app.request("http://localhost/auth/login?returnTo=/app/namrata");
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location")!);
    expect(to.origin).toBe(idp.issuer);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("scope")).toContain("openid");
    expect(to.searchParams.get("redirect_uri")).toBe("http://localhost/auth/callback");
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const code = idp.grant(
      {
        state: to.searchParams.get("state")!,
        nonce: to.searchParams.get("nonce")!,
        challenge: to.searchParams.get("code_challenge")!,
      },
      identity,
      { audience: tweak.audience, nonce: tweak.nonce },
    );
    return p.runtime.app.request(
      `http://localhost/auth/callback?code=${code}&state=${tweak.state ?? to.searchParams.get("state")}`,
      {
        headers: tweak.dropFlowCookie ? {} : { cookie },
      },
    );
  }

  it("completes the flow, creates the account, sets a session and returns where the person was going", async () => {
    const res = await signIn({
      sub: "sub-1",
      email: "Priya@Example.org",
      email_verified: true,
      name: "Priya",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/namrata");
    const session = res.headers.getSetCookie().find((c) => c.startsWith("session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    const me = await p.runtime.app.request("http://localhost/api/me", {
      headers: { cookie: session.split(";")[0]! },
    });
    expect((await me.json()).account).toMatchObject({ email: "priya@example.org", name: "Priya" });
    const again = await signIn({
      sub: "sub-1",
      email: "priya@example.org",
      email_verified: true,
      name: "Priya",
    });
    expect(again.status).toBe(302);
    expect((await p.runtime.deps.control.accountByEmail("priya@example.org"))!.id).toBeTruthy();
  });

  it("refuses an unverified email, a token for another sign-in, another audience, and a lost or wrong state", async () => {
    const ok = { sub: "sub-2", email: "x@example.org", name: "X" };
    expect((await signIn({ ...ok, email_verified: false })).status).toBe(400);
    expect(
      (await signIn({ ...ok, email_verified: true }, { nonce: "someone-elses-nonce" })).status,
    ).toBe(400);
    expect(
      (await signIn({ ...ok, email_verified: true }, { audience: "another-client" })).status,
    ).toBe(400);
    expect((await signIn({ ...ok, email_verified: true }, { state: "forged" })).status).toBe(400);
    expect((await signIn({ ...ok, email_verified: true }, { dropFlowCookie: true })).status).toBe(
      400,
    );
    expect((await signIn({ sub: "sub-3", email_verified: true })).status).toBe(400); // no email shared
    expect(await p.runtime.deps.control.accountByEmail("x@example.org")).toBeUndefined();
  });

  it("never sends a person to another site after signing in", async () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const start = await p.runtime.app.request(
        `http://localhost/auth/login?returnTo=${encodeURIComponent(bad)}`,
      );
      const to = new URL(start.headers.get("location")!);
      const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
      const code = idp.grant(
        {
          state: to.searchParams.get("state")!,
          nonce: to.searchParams.get("nonce")!,
          challenge: to.searchParams.get("code_challenge")!,
        },
        { sub: "sub-r", email: "r@example.org", email_verified: true },
      );
      const res = await p.runtime.app.request(
        `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get("state")}`,
        { headers: { cookie } },
      );
      expect(res.headers.get("location")).toBe("/app");
    }
  });

  it("does not let a code be used twice", async () => {
    const start = await p.runtime.app.request("http://localhost/auth/login");
    const to = new URL(start.headers.get("location")!);
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const code = idp.grant(
      {
        state: to.searchParams.get("state")!,
        nonce: to.searchParams.get("nonce")!,
        challenge: to.searchParams.get("code_challenge")!,
      },
      { sub: "sub-4", email: "four@example.org", email_verified: true },
    );
    const url = `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get("state")}`;
    expect((await p.runtime.app.request(url, { headers: { cookie } })).status).toBe(302);
    expect((await p.runtime.app.request(url, { headers: { cookie } })).status).toBe(400);
  });
});

describe("configuration", () => {
  const base = {
    APP_ORIGIN: "https://alimentation.example",
    SESSION_SECRETS: b64(),
    MASTER_KEYS: `1:${b64()}`,
    CONTROL_DATABASE_URL: "postgres://x",
    NODE_ENV: "production",
  };
  const oidc = {
    OIDC_ISSUER: "https://accounts.example",
    OIDC_CLIENT_ID: "a",
    OIDC_CLIENT_SECRET: "b",
  };

  it("refuses development sign-in in production, plain http in production, and a server nobody can sign in to", () => {
    expect(() => loadConfig({ ...base, ...oidc, AUTH_DEV: "1" })).toThrow(/refused in production/);
    expect(() =>
      loadConfig({ ...base, ...oidc, APP_ORIGIN: "http://alimentation.example" }),
    ).toThrow(/https/);
    expect(() => loadConfig({ ...base })).toThrow(/OIDC_ISSUER/);
    expect(loadConfig({ ...base, ...oidc }).secure).toBe(true);
    expect(
      loadConfig({
        ...base,
        NODE_ENV: "development",
        APP_ORIGIN: "http://localhost:8787",
        AUTH_DEV: "1",
      }).authDev,
    ).toBe(true);
  });

  it("lets a host change the free-tier numbers without a release", () => {
    const c = loadConfig({
      ...base,
      ...oidc,
      FREE_LIMITS_JSON: '{"people":40}',
      CAPACITY_JSON: '{"hostProjects":300}',
    });
    expect(c.freeLimits).toMatchObject({ people: 40, requestsPerDay: 1000 });
    expect(c.capacity.hostProjects).toBe(300);
  });

  it("reads Microsoft's xms_edov only when it is chosen, and only from the address of one tenant", () => {
    const tenant = "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
    const at = (OIDC_ISSUER: string, extra: Record<string, string> = {}) =>
      loadConfig({ ...base, ...oidc, OIDC_ISSUER, ...extra }).oidc!.emailVerifiedClaim;
    expect(at("https://accounts.example")).toBe("email_verified");
    expect(at(tenant, { OIDC_EMAIL_VERIFIED_CLAIM: "" })).toBe("email_verified");
    expect(at(tenant, { OIDC_EMAIL_VERIFIED_CLAIM: "xms_edov" })).toBe("xms_edov");
    for (const shared of ["common", "organizations", "consumers"])
      expect(() =>
        at(`https://login.microsoftonline.com/${shared}/v2.0`, {
          OIDC_EMAIL_VERIFIED_CLAIM: "xms_edov",
        }),
      ).toThrow(/address of one tenant/);
    // The shared addresses are only refused when the choice is made; without it nothing about them changes.
    expect(at("https://login.microsoftonline.com/common/v2.0")).toBe("email_verified");
    expect(() => at(tenant, { OIDC_EMAIL_VERIFIED_CLAIM: "email" })).toThrow();
  });

  it("normalises operator emails", () => {
    expect([
      ...loadConfig({ ...base, ...oidc, OPERATOR_EMAILS: " A@x.org , b@x.org " }).operators,
    ]).toEqual(["a@x.org", "b@x.org"]);
  });
});

describe("signed tokens", () => {
  const now = new Date("2026-10-24T06:00:00Z");
  it("verify while fresh and not after, and reject another key, a changed body and junk", async () => {
    const a = await TokenSigner.fromSecrets([b64()]);
    const b = await TokenSigner.fromSecrets([b64()]);
    const t = await a.sign({ a: "one" }, 60, now);
    expect((await a.verify<{ a: string }>(t, now))!.a).toBe("one");
    expect(await a.verify(t, new Date(now.getTime() + 61_000))).toBeNull();
    expect(await b.verify(t, now)).toBeNull();
    const [body, mac] = t.split(".");
    expect(await a.verify(`${body}A.${mac}`, now)).toBeNull();
    for (const junk of ["", "x", ".", "a.b", "a".repeat(5000), null, undefined])
      expect(await a.verify(junk as never, now)).toBeNull();
  });

  it("rotate: the newest key signs, the older ones still verify", async () => {
    const oldSecret = b64();
    const old = await TokenSigner.fromSecrets([oldSecret]);
    const t = await old.sign({ a: "one" }, 60, now);
    const rotated = await TokenSigner.fromSecrets([b64(), oldSecret]);
    expect(await rotated.verify(t, now)).not.toBeNull();
    expect(await old.verify(await rotated.sign({ a: "two" }, 60, now), now)).toBeNull();
  });

  it("refuses a short secret and none at all", async () => {
    await expect(
      TokenSigner.fromSecrets([Buffer.from("short").toString("base64")]),
    ).rejects.toThrow(/32 bytes/);
    await expect(TokenSigner.fromSecrets([])).rejects.toThrow(/no session secret/);
  });
});

/** The browser's half of a sign-in, against whichever provider is given: start, approve, come back. */
async function walk(
  p: TestPlatform,
  idp: MockOidc,
  identity: Record<string, unknown>,
  grant: Parameters<MockOidc["grant"]>[2] = {},
) {
  const start = await p.runtime.app.request("http://localhost/auth/login");
  const to = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const code = idp.grant(
    {
      state: to.searchParams.get("state")!,
      nonce: to.searchParams.get("nonce")!,
      challenge: to.searchParams.get("code_challenge")!,
    },
    identity,
    grant,
  );
  const back = await p.runtime.app.request(
    `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get("state")}`,
    { headers: { cookie } },
  );
  return { to, back };
}

async function against(
  options: MockOidcOptions,
  secret = "secret-1",
): Promise<{ idp: MockOidc; p: TestPlatform; done: () => Promise<void> }> {
  const idp = await startMockOidc("client-1", secret, options);
  const p = await makePlatform(
    {
      OIDC_ISSUER: idp.issuer,
      OIDC_CLIENT_ID: "client-1",
      OIDC_CLIENT_SECRET: secret,
      AUTH_DEV: "0",
    },
    { devAuth: false },
  );
  return {
    idp,
    p,
    done: async () => {
      await p.destroy();
      await idp.close();
    },
  };
}

describe("signing in with a provider that keeps the email out of the identity token", () => {
  // Authelia and Zitadel do, unless they are told otherwise: the claims are for the userinfo endpoint.
  let k: Awaited<ReturnType<typeof against>>;
  beforeAll(async () => (k = await against({ userinfo: true })));
  afterAll(() => k.done());

  const who = { sub: "u-1", email: "Asha@Example.org", email_verified: true, name: "Asha" };

  it("asks the userinfo endpoint, and signs in with what it says", async () => {
    const before = k.idp.userinfoCalls;
    const { back } = await walk(k.p, k.idp, who, {
      onlyInUserinfo: ["email", "email_verified", "name"],
    });
    expect(back.status).toBe(302);
    expect(k.idp.userinfoCalls).toBe(before + 1);
    const account = await k.p.runtime.deps.control.accountByEmail("asha@example.org");
    expect(account).toMatchObject({ displayName: "Asha" });
  });

  it("asks only for what the identity token left out", async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: "u-2", email: "only-verified@example.org", email_verified: true },
      { onlyInUserinfo: ["email_verified"] },
    );
    expect(back.status).toBe(302);
    expect(await k.p.runtime.deps.control.accountByEmail("only-verified@example.org")).toBeTruthy();
  });

  it("does not ask when the identity token has it all", async () => {
    const before = k.idp.userinfoCalls;
    const { back } = await walk(k.p, k.idp, {
      sub: "u-3",
      email: "all@example.org",
      email_verified: true,
    });
    expect(back.status).toBe(302);
    expect(k.idp.userinfoCalls).toBe(before);
  });

  it("still refuses an email the provider does not vouch for, wherever it says so", async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: "u-4", email: "unvouched@example.org", email_verified: false },
      { onlyInUserinfo: ["email", "email_verified"] },
    );
    expect(back.status).toBe(400);
    expect(await k.p.runtime.deps.control.accountByEmail("unvouched@example.org")).toBeUndefined();
  });

  it("refuses an answer about someone else, and a verified flag that belongs to another email", async () => {
    const other = await walk(
      k.p,
      k.idp,
      { sub: "u-5", email: "swapped@example.org", email_verified: true },
      { onlyInUserinfo: ["email", "email_verified"], userinfoSub: "someone-else" },
    );
    expect(other.back.status).toBe(400);
    expect(await k.p.runtime.deps.control.accountByEmail("swapped@example.org")).toBeUndefined();

    // The token names one address; the userinfo says another is verified. The first is not vouched for.
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: "u-6", email: "named@example.org", email_verified: true },
      { onlyInUserinfo: ["email_verified"] },
    );
    expect(back.status).toBe(302); // the same address, so it is the one vouched for
    const mismatch = await walk(k.p, k.idp, { sub: "u-7", email: "claimed@example.org" });
    expect(mismatch.back.status).toBe(400); // nothing says it is verified
  });
});

describe("signing in with a provider that has no userinfo endpoint", () => {
  let k: Awaited<ReturnType<typeof against>>;
  beforeAll(async () => (k = await against({})));
  afterAll(() => k.done());

  it("says the provider shared no email, when the identity token has none", async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: "n-1", email: "gone@example.org", email_verified: true },
      {
        onlyInUserinfo: ["email"],
      },
    );
    expect(back.status).toBe(400);
    expect(await back.json()).toMatchObject({ error: { code: "sign_in_failed" } });
  });
});

describe("how the app proves itself to the token endpoint", () => {
  const who = { sub: "a-1", email: "auth@example.org", email_verified: true };

  it("sends the secret in the body, as it always has, when the provider does not say", async () => {
    const k = await against({ registeredAs: "post" });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe("post");
    } finally {
      await k.done();
    }
  });

  it("keeps to the body when the provider takes either", async () => {
    const k = await against({
      advertise: ["client_secret_basic", "client_secret_post"],
      registeredAs: "post",
    });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe("post");
    } finally {
      await k.done();
    }
  });

  it("uses HTTP Basic when that is the only way the provider takes it", async () => {
    const k = await against({ advertise: ["client_secret_basic"], registeredAs: "basic" });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe("basic");
    } finally {
      await k.done();
    }
  });

  it("encodes the two halves of a Basic credential before joining them, so a colon or a percent sign survives", async () => {
    const secret = "se:cr/et%+ü 1";
    const k = await against({ advertise: ["client_secret_basic"], registeredAs: "basic" }, secret);
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
    } finally {
      await k.done();
    }
  });
});

describe("asking the provider to let the person choose an account", () => {
  it("asks, unless the provider says it does not understand that", async () => {
    const plain = await against({});
    const strict = await against({ promptValues: ["none", "login", "consent"] });
    const knows = await against({ promptValues: ["none", "login", "consent", "select_account"] });
    try {
      for (const [k, expected] of [
        [plain, "select_account"],
        [strict, null],
        [knows, "select_account"],
      ] as const) {
        const { to } = await walk(k.p, k.idp, {
          sub: "p-1",
          email: "p@example.org",
          email_verified: true,
        });
        expect(to.searchParams.get("prompt")).toBe(expected);
      }
    } finally {
      await plain.done();
      await strict.done();
      await knows.done();
    }
  });
});

/**
 * The providers this was written for. Their discovery documents are their own, as published on 2026-11-01
 * (support/discovery), and what comes back is the shape of what each is known to send. What is pinned here
 * is what the app asks of each and what it decides, so that a change made for another provider cannot
 * quietly change how these are treated. Where a provider is refused, that is how it was before too, and the
 * reason is written next to it.
 */
describe("the providers it was written for are treated as they always were", () => {
  const document = (name: string) =>
    JSON.parse(
      readFileSync(join(import.meta.dirname, "support", "discovery", `${name}.json`), "utf8"),
    );

  async function through(
    name: "google" | "microsoft" | "apple" | "meta",
    issuer: string,
    claims: Record<string, unknown>,
    tokenIssuer?: string,
    emailVerifiedClaim?: "email_verified" | "xms_edov",
  ) {
    const doc = document(name);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" };
    const asked: { token?: { authorization: boolean; body: URLSearchParams }; userinfo: number } = {
      userinfo: 0,
    };
    const answer = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    const fake = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return answer(doc);
      if (url === doc.jwks_uri) return answer({ keys: [jwk] });
      if (url === doc.token_endpoint) {
        asked.token = {
          authorization: new Headers(init?.headers).has("authorization"),
          body: new URLSearchParams(String(init?.body)),
        };
        const id = await new SignJWT({ ...claims, nonce: "N" })
          .setProtectedHeader({ alg: "RS256", kid: "k" })
          .setIssuer(tokenIssuer ?? doc.issuer)
          .setAudience("client")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return answer({ id_token: id, access_token: "at", token_type: "Bearer" });
      }
      if (url === doc.userinfo_endpoint) {
        asked.userinfo++;
        return answer({ sub: claims.sub });
      }
      return answer({ error: `unexpected ${url}` }, 500);
    }) as typeof fetch;
    // The keys are fetched with the global fetch.
    vi.stubGlobal("fetch", fake);
    try {
      const client = new OidcClient(
        { issuer, clientId: "client", clientSecret: "secret", emailVerifiedClaim },
        fake,
      );
      const sent: URLSearchParams[] = [];
      let who: Awaited<ReturnType<OidcClient["exchange"]>> | undefined;
      let refused: string | undefined;
      try {
        const url = await client.authorizeUrl({
          redirectUri: "https://app.example/auth/callback",
          state: "S",
          nonce: "N",
          verifier: "V",
        });
        sent.push(new URL(url).searchParams);
        who = await client.exchange({
          code: "C",
          verifier: "V",
          redirectUri: "https://app.example/auth/callback",
          nonce: "N",
        });
      } catch (e) {
        refused = (e as Error).message;
      }
      return { who, refused, asked, authorize: sent[0] };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("Google: asks to choose an account, sends the secret in the body, and signs in a verified email", async () => {
    const r = await through("google", "https://accounts.google.com", {
      sub: "1",
      email: "Asha@Gmail.com",
      email_verified: true,
      name: "Asha",
    });
    expect(r.who).toEqual({ sub: "1", email: "asha@gmail.com", name: "Asha" });
    expect(r.authorize!.get("prompt")).toBe("select_account");
    expect(r.authorize!.get("scope")).toBe("openid email profile");
    expect(r.authorize!.get("code_challenge_method")).toBe("S256");
    expect(r.asked.token!.authorization).toBe(false);
    expect(r.asked.token!.body.get("client_secret")).toBe("secret");
    expect(r.asked.token!.body.get("client_id")).toBe("client");
    // The identity token has everything, so nothing else is asked.
    expect(r.asked.userinfo).toBe(0);
  });

  it("Google: refuses an email it does not vouch for", async () => {
    const r = await through("google", "https://accounts.google.com", {
      sub: "1",
      email: "a@gmail.com",
      email_verified: false,
    });
    expect(r.refused).toMatch(/not verified/);
    expect(r.asked.userinfo).toBe(0);
  });

  it("Microsoft: is asked and answered the same way, and is refused because Entra sends no verified flag", async () => {
    const issuer = "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
    const r = await through("microsoft", issuer, {
      sub: "m1",
      name: "Asha",
      email: "asha@contoso.com",
      preferred_username: "asha@contoso.com",
    });
    // Entra's own document does not list email_verified among its claims. It is refused, as it was; and
    // because it cannot say, the userinfo endpoint is not asked for what it does not have.
    expect(r.refused).toMatch(/not verified/);
    expect(r.asked.userinfo).toBe(0);
    expect(r.authorize!.get("prompt")).toBe("select_account");
    expect(r.asked.token!.authorization).toBe(false);
    expect(r.asked.token!.body.get("client_secret")).toBe("secret");
  });

  it("Microsoft: through /common, whose document names an issuer with {tenantid} in it, is refused as it was", async () => {
    const r = await through(
      "microsoft",
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      { sub: "m1", email: "asha@contoso.com", email_verified: true },
      "https://login.microsoftonline.com/another-tenant/v2.0",
    );
    expect(r.refused).toMatch(/did not verify/);
  });

  describe("Microsoft, when the deployment has chosen to trust xms_edov", () => {
    const tenant = "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
    const asha = { sub: "m1", name: "Asha", email: "Asha@Contoso.com" };
    const trusting = (claims: Record<string, unknown>) =>
      through("microsoft", tenant, claims, undefined, "xms_edov");

    it("signs in an address whose domain the tenant has verified, asking and answering as before", async () => {
      const r = await trusting({ ...asha, xms_edov: true });
      expect(r.who).toEqual({ sub: "m1", email: "asha@contoso.com", name: "Asha" });
      expect(r.authorize!.get("scope")).toBe("openid email profile");
      expect(r.authorize!.get("prompt")).toBe("select_account");
      expect(r.asked.token!.authorization).toBe(false);
      // Entra's userinfo cannot say it, so it is not asked.
      expect(r.asked.userinfo).toBe(0);
    });

    it("refuses an address the tenant has not verified, in any other form than the boolean true", async () => {
      for (const edov of [false, "true", 1, "1", null, undefined])
        expect((await trusting({ ...asha, xms_edov: edov })).refused, String(edov)).toMatch(
          /not verified/,
        );
    });

    it("counts only that claim: a token that says email_verified without it is refused", async () => {
      expect((await trusting({ ...asha, email_verified: true })).refused).toMatch(/not verified/);
    });

    it("needs the email in the identity token, because that is the only place the claim is sent", async () => {
      const r = await trusting({
        sub: "m1",
        xms_edov: true,
        preferred_username: "asha@contoso.com",
      });
      expect(r.refused).toMatch(/did not share an email/);
      expect(r.asked.userinfo).toBe(0);
    });

    it("is not the default: without the choice, the claim is ignored and the person is refused as before", async () => {
      const r = await through("microsoft", tenant, { ...asha, xms_edov: true });
      expect(r.refused).toMatch(/not verified/);
    });
  });

  it("Apple: sends the secret in the body, which is the only way it takes it, and signs in a verified email", async () => {
    const r = await through("apple", "https://appleid.apple.com", {
      sub: "a1",
      email: "x@icloud.com",
      email_verified: true,
    });
    expect(r.who?.email).toBe("x@icloud.com");
    expect(r.asked.token!.authorization).toBe(false);
    expect(r.asked.token!.body.get("client_secret")).toBe("secret");
    expect(r.asked.userinfo).toBe(0);
  });

  it('Apple: refuses the string "true", which is how it says an email is verified, as it did before', async () => {
    const r = await through("apple", "https://appleid.apple.com", {
      sub: "a1",
      email: "x@privaterelay.appleid.com",
      email_verified: "true",
    });
    expect(r.refused).toMatch(/not verified/);
  });

  it("Meta: has no sign-in by authorization code to offer, and says so before anything is sent", async () => {
    const r = await through("meta", "https://www.facebook.com", {
      sub: "f1",
      email: "x@example.org",
      email_verified: true,
    });
    expect(r.refused).toMatch(/does not offer sign-in by authorization code/);
    expect(r.asked.token).toBeUndefined();
  });
});
