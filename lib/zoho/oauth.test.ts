import { describe, expect, it } from "vitest";
import { MailProviderError } from "@/lib/mail/types";
import { ZohoMailClient } from "@/lib/mail/zoho";
import { EsignError } from "@/lib/esign/types";
import { ZohoSignProvider } from "@/lib/esign/zoho-sign";
import { classifyOAuthFailure, MemoryZohoTokenCache, refreshTokenKey, ZohoAccessTokens, ZohoOAuthError, type FetchLike } from "./oauth";

const tokenResponse = (token: string) => Response.json({ access_token: token, expires_in: 3600 });

function counter(handler: (n: number) => Response) {
  let n = 0;
  const fetchImpl: FetchLike = async () => handler(++n);
  return { fetchImpl, count: () => n };
}

const base = { accountsUrl: "https://accounts.zoho.com", clientId: "cid", clientSecret: "secret", refreshToken: "rt-shared", sleep: async () => undefined };

describe("shared Zoho access tokens", () => {
  it("cold instances reuse the token another instance minted instead of refreshing again", async () => {
    const cache = new MemoryZohoTokenCache();
    const zoho = counter((n) => tokenResponse(`at-${n}`));
    const instances = Array.from({ length: 5 }, () => new ZohoAccessTokens({ ...base, fetch: zoho.fetchImpl, cache }));
    for (const i of instances) expect(await i.get()).toBe("at-1");
    expect(zoho.count()).toBe(1);
  });

  it("evicts a token rejected with 401 from the shared cache and mints one new token", async () => {
    const cache = new MemoryZohoTokenCache();
    const zoho = counter((n) => tokenResponse(`at-${n}`));
    const a = new ZohoAccessTokens({ ...base, fetch: zoho.fetchImpl, cache });
    const b = new ZohoAccessTokens({ ...base, fetch: zoho.fetchImpl, cache });
    expect(await a.get()).toBe("at-1");
    expect(await a.get({ stale: "at-1" })).toBe("at-2");
    expect(await b.get()).toBe("at-2");
    expect(zoho.count()).toBe(2);
  });

  it("waits for the instance holding the refresh lock rather than minting a second token", async () => {
    const cache = new MemoryZohoTokenCache();
    await cache.setIfAbsent(`kubera:zoho:at:${refreshTokenKey("rt-shared", "cid")}:lock`, "other", 10_000);
    const zoho = counter((n) => tokenResponse(`at-${n}`));
    let polls = 0;
    const waiting = new ZohoAccessTokens({
      ...base,
      fetch: zoho.fetchImpl,
      cache,
      sleep: async () => {
        if (++polls === 2) {
          // The other instance finishes its refresh.
          const minted = new ZohoAccessTokens({ ...base, fetch: async () => tokenResponse("at-other"), cache: new MemoryZohoTokenCache() });
          await cache.set(`kubera:zoho:at:${refreshTokenKey("rt-shared", "cid")}`, JSON.stringify({ token: await minted.get(), expiresAt: Date.now() + 3_600_000 }), 3_600_000);
        }
      },
    });
    expect(await waiting.get()).toBe("at-other");
    expect(zoho.count()).toBe(0);
  });

  it("treats a throttled refresh (HTTP 200 or 400 with an error body, or 429) as retryable and backs off across instances", async () => {
    for (const reply of [
      () => Response.json({ error: "Access Denied", error_description: "You have made too many requests continuously. Please try again after some time." }, { status: 400 }),
      () => Response.json({ error: "Access Denied" }, { status: 200 }),
      () => new Response("slow down", { status: 429 }),
    ]) {
      const cache = new MemoryZohoTokenCache();
      const zoho = counter(reply);
      const a = new ZohoAccessTokens({ ...base, fetch: zoho.fetchImpl, cache });
      const err = await a.get().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ZohoOAuthError);
      expect(err).toMatchObject({ retryable: true });
      expect((err as ZohoOAuthError).retryAfterMs).toBeGreaterThan(0);
      // A second instance inside the cooldown does not call Zoho at all.
      const b = new ZohoAccessTokens({ ...base, fetch: zoho.fetchImpl, cache });
      await expect(b.get()).rejects.toMatchObject({ retryable: true });
      expect(zoho.count()).toBe(1);
    }
  });

  it("classifies configuration errors as permanent and outages as retryable", () => {
    expect(classifyOAuthFailure(200, { error: "invalid_code" })).toEqual({ retryable: false, throttled: false });
    expect(classifyOAuthFailure(400, { error: "invalid_client" })).toEqual({ retryable: false, throttled: false });
    expect(classifyOAuthFailure(503, {})).toEqual({ retryable: true, throttled: false });
    expect(classifyOAuthFailure(null, null)).toEqual({ retryable: true, throttled: false });
    expect(classifyOAuthFailure(400, { error: "Access Denied" })).toEqual({ retryable: true, throttled: true });
  });

  it("Zoho Mail raises a retryable MailProviderError when the refresh is throttled", async () => {
    const client = new ZohoMailClient({
      clientId: "cid",
      clientSecret: "secret",
      dc: "com",
      refreshTokens: { deals: "rt" },
      accountIds: { deals: "1" },
      addresses: { deals: "deals@kuberacommercial.com", docs: "docs@kuberacommercial.com", lenders: "lenders@kuberacommercial.com", vendors: "vendors@kuberacommercial.com", closing: "closing@kuberacommercial.com" },
      fetch: (async () => Response.json({ error: "Access Denied" }, { status: 400 })) as unknown as typeof fetch,
      tokenCache: new MemoryZohoTokenCache(),
    });
    const err = await client.listNew("deals", null, 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailProviderError);
    expect(err).toMatchObject({ retryable: true });
  });

  it("Zoho Sign raises a retryable EsignError when the refresh is throttled", async () => {
    const z = new ZohoSignProvider({ clientId: "cid", clientSecret: "s", refreshToken: "rt", dc: "com" }, async () => Response.json({ error: "Access Denied" }), () => Date.now(), new MemoryZohoTokenCache());
    const err = await z.getStatus("r1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EsignError);
    expect(err).toMatchObject({ retryable: true });
  });
});
