// S9: the approved email and its share link render once. The page only
// learns that one is waiting; claiming it reads and deletes the one-time
// cookies in the same step, so a second claim (a refresh, another tab) gets
// nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const jar = new Map<string, { value: string; path?: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts: { path?: string }) => void jar.set(name, { value, path: opts.path }),
    delete: (o: { name: string; path?: string }) => void jar.delete(o.name),
  }),
}));

const { claimShareLink, hasPendingShareLink, rememberShareLink } = await import("./share-once");

const DEAL = "10000000-0000-4000-8000-000000000010";
const URL = "https://corincommercial.com/api/deals/share/abc";

describe("the one-time share link", () => {
  beforeEach(() => jar.clear());

  it("is claimed once: the first claim returns it and deletes it, the second gets nothing", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    expect(jar.get("deal_share_url")?.path).toBe(`/deals/${DEAL}`);
    expect(await hasPendingShareLink()).toBe(true);
    expect(await claimShareLink(DEAL)).toEqual({ shareUrl: URL, outreachId: "outreach-1" });
    expect(await hasPendingShareLink()).toBe(false);
    expect(await claimShareLink(DEAL)).toBeNull();
  });

  it("rendering only learns that one is waiting, never the URL", async () => {
    await rememberShareLink(DEAL, URL, "outreach-1");
    expect(await hasPendingShareLink()).toBe(true);
    // Asking again does not consume it; only the claim does.
    expect(await hasPendingShareLink()).toBe(true);
    expect(jar.size).toBe(2);
  });
});
