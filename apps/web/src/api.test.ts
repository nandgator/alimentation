import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, api } from "./api.ts";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("asking a kitchen that says to slow down", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits as long as it is told and reads again, so a quick burst is a pause and not an error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply(429, { error: { code: "rate_limited" } }, { "retry-after": "1" }),
      )
      .mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const got = api.get<{ ok: boolean }>("/api/w/x/bootstrap");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await got).data).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up after a few tries and says what the kitchen said", async () => {
    const fetcher = vi.fn(async () =>
      reply(
        429,
        { error: { code: "rate_limited", message: "Slow down a little." } },
        { "retry-after": "1" },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const got = api.get("/api/w/x/bootstrap").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const e = await got;
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).message).toBe("Slow down a little.");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not wait out the day's budget, which resets hours from now", async () => {
    const fetcher = vi.fn(async () =>
      reply(429, { error: { code: "budget_reached" } }, { "retry-after": "40000" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(api.get("/api/w/x/bootstrap")).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never repeats a request that writes: that is the person's to decide", async () => {
    const fetcher = vi.fn(async () =>
      reply(429, { error: { code: "rate_limited" } }, { "retry-after": "1" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(api.post("/api/w/x/log", {})).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
