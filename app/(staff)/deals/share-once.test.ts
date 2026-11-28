// S9 / N4: the approved email and its share link render once. The page only
// learns that one is waiting; claiming it reads and deletes the one-time
// cookie in the same step, so a second claim (a refresh, another tab) gets
// nothing. A claim names its deal: a claim for another deal, sent from this
// deal's page, is refused and consumes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A cookie jar that honours `path` the way a browser and Next do: a cookie is
// sent only to requests under the path it was set on, and a delete removes
// only the cookie stored at the path it names.
const jar = new Map<string, { name: string; value: string; path: string }>();
let requestPath = "/";
const key = (name: string, path: string) => `${path}\u0000${name}`;
const pathMatches = (cookiePath: string, request: string) => request === cookiePath || request.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const hit = [...jar.values()].filter((c) => c.name === name && pathMatches(c.path, requestPath)).sort((a, b) => b.path.length - a.path.length)[0];
      return hit ? { name, value: hit.value } : undefined;
    },
    set: (name: string, value: string, opts: { path?: string }) => void jar.set(key(name, opts.path ?? "/"), { name, value, path: opts.path ?? "/" }),
    delete: (o: { name: string; path?: string }) => void jar.delete(key(o.name, o.path ?? "/")),
  }),
}));

const { claimShareLink, forgetShareLink, hasPendingShareLink, rememberShareLink } = await import("./share-once");

const DEAL = "10000000-0000-4000-8000-000000000010";
const OTHER = "10000000-0000-4000-8000-000000000011";
const URL = "https://corincommercial.com/api/deals/share/abc";

describe("the one-time share link", () => {
  beforeEach(() => {
    jar.clear();
    requestPath = `/deals/${DEAL}`;
  });

  it("is claimed once: the first claim returns it and deletes it, the second gets nothing", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    expect([...jar.values()].map((c) => c.path)).toEqual([`/deals/${DEAL}`]);
    expect(await hasPendingShareLink(DEAL)).toBe(true);
    expect(await claimShareLink(DEAL)).toEqual({ shareUrl: URL, outreachId: "outreach-1" });
    expect(await hasPendingShareLink(DEAL)).toBe(false);
    expect(await claimShareLink(DEAL)).toBeNull();
    expect(jar.size).toBe(0);
  });

  it("rendering only learns that one is waiting, never the URL", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    expect(await hasPendingShareLink(DEAL)).toBe(true);
    // Asking again does not consume it; only the claim does.
    expect(await hasPendingShareLink(DEAL)).toBe(true);
    expect(jar.size).toBe(1);
  });

  it("refuses a claim for another deal made from this deal's page, and the real claim still gets it once", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    // The action posts from this deal's page, so the cookie is sent with it.
    expect(await claimShareLink(OTHER)).toBeNull();
    expect(await claimShareLink(OTHER)).toBeNull();
    expect(await hasPendingShareLink(OTHER)).toBe(false);
    expect(await hasPendingShareLink(DEAL)).toBe(true);
    expect(await claimShareLink(DEAL)).toEqual({ shareUrl: URL, outreachId: "outreach-1" });
    expect(await claimShareLink(DEAL)).toBeNull();
  });

  it("is not sent to another deal's page at all", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    requestPath = `/deals/${OTHER}`;
    expect(await hasPendingShareLink(OTHER)).toBe(false);
    expect(await claimShareLink(OTHER)).toBeNull();
    requestPath = `/deals/${DEAL}/submission`;
    expect(await hasPendingShareLink(DEAL)).toBe(true);
  });

  it("forgetting it after a send or withdrawal deletes it at its own path", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    await forgetShareLink(DEAL);
    expect(jar.size).toBe(0);
    expect(await claimShareLink(DEAL)).toBeNull();
  });

  it("drops a cookie it cannot read instead of showing it", async () => {
    jar.set(key("deal_share", `/deals/${DEAL}`), { name: "deal_share", value: "not json", path: `/deals/${DEAL}` });
    expect(await hasPendingShareLink(DEAL)).toBe(false);
    expect(await claimShareLink(DEAL)).toBeNull();
    expect(jar.size).toBe(0);
  });
});
