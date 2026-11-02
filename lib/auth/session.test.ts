import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REFRESH_LEEWAY_SECONDS,
  cookieOptions,
  decodePendingLogin,
  decodeSession,
  encodePendingLogin,
  encodeSession,
  remainingLifetime,
  safeNextPath,
  sessionMaxAgeSeconds,
  sessionState,
  toStored,
} from "./session";

const stored = { accessToken: "at", refreshToken: "rt", expiresAt: 10_000, issuedAt: 1_000 };

describe("session cookie", () => {
  const KEY = "k".repeat(32);
  const signed = (raw: unknown) => {
    const payload = Buffer.from(JSON.stringify(raw)).toString("base64url");
    const mac = createHmac("sha256", KEY).update(`cc_session.v1.${payload}`).digest("base64url");
    return `${payload}.${mac}`;
  };

  it("round-trips signed values", () => {
    expect(decodeSession(encodeSession(stored, KEY), KEY)).toEqual(stored);
  });

  it("rejects unsigned, re-signed, edited or malformed values", () => {
    const good = encodeSession(stored, KEY);
    expect(decodeSession(good, "another-key".repeat(4))).toBeNull();
    const [payload, mac] = good.split(".");
    const edited = Buffer.from(JSON.stringify({ v: 1, a: "at", r: "rt", e: 10_000, i: 9_999_999 })).toString("base64url");
    expect(decodeSession(`${edited}.${mac}`, KEY)).toBeNull();
    expect(decodeSession(payload, KEY)).toBeNull();
    expect(decodeSession(undefined, KEY)).toBeNull();
    expect(decodeSession("not-base64-json.x", KEY)).toBeNull();
    expect(decodeSession(signed({ v: 2, a: "a", r: "r", e: 1, i: 1 }), KEY)).toBeNull();
    expect(decodeSession(signed({ v: 1, a: "", r: "r", e: 1, i: 1 }), KEY)).toBeNull();
    expect(decodeSession(signed({ v: 1, a: "a", r: "r", e: "1", i: 1 }), KEY)).toBeNull();
    expect(decodeSession(signed({ v: 1, a: "a", r: "r", e: 1, i: 1 }), KEY)).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 1, issuedAt: 1 });
    expect(decodeSession("x".repeat(9000), KEY)).toBeNull();
  });

  it("classifies sessions by token expiry and absolute lifetime", () => {
    const max = 12 * 3600;
    expect(sessionState(null, 2_000, max)).toBe("missing");
    expect(sessionState(stored, 2_000, max)).toBe("valid");
    expect(sessionState(stored, 10_000 - REFRESH_LEEWAY_SECONDS, max)).toBe("needs_refresh");
    expect(sessionState(stored, 1_000 + max, max)).toBe("too_old");
    // A sign-in time from the future is never trusted.
    expect(sessionState({ ...stored, issuedAt: 5_000 }, 2_000, max)).toBe("too_old");
  });

  it("keeps the original sign-in time across refreshes", () => {
    const fresh = { accessToken: "a2", refreshToken: "r2", expiresAt: 20_000, user: { id: "u", email: "e@x.co" }, aal: "aal2" as const };
    expect(toStored(fresh, 1_000)).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: 20_000, issuedAt: 1_000 });
    expect(remainingLifetime(stored, 2_000, 3_600)).toBe(2_600);
    expect(remainingLifetime(stored, 9_000, 3_600)).toBe(0);
  });

  it("reads the absolute lifetime from env with sane bounds", () => {
    expect(sessionMaxAgeSeconds({})).toBe(12 * 3600);
    expect(sessionMaxAgeSeconds({ STAFF_SESSION_MAX_HOURS: "8" })).toBe(8 * 3600);
    expect(sessionMaxAgeSeconds({ STAFF_SESSION_MAX_HOURS: "-1" })).toBe(12 * 3600);
    expect(sessionMaxAgeSeconds({ STAFF_SESSION_MAX_HOURS: "100000" })).toBe(12 * 3600);
  });

  it("sets httpOnly, SameSite=Lax cookies that are Secure in production", () => {
    expect(cookieOptions(60, { NODE_ENV: "production" })).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 });
    expect(cookieOptions(60.9, { NODE_ENV: "development" }).secure).toBe(false);
    expect(cookieOptions(-5, {}).maxAge).toBe(0);
  });

  it("expires the pending sign-in after 15 minutes", () => {
    const v = encodePendingLogin({ email: "pat@corin.test", next: "/approvals", sentAt: 1_000 });
    expect(decodePendingLogin(v, 1_100)).toEqual({ email: "pat@corin.test", next: "/approvals", sentAt: 1_000 });
    expect(decodePendingLogin(v, 1_000 + 16 * 60)).toBeNull();
    expect(decodePendingLogin(encodePendingLogin({ email: "p@x.co", next: "https://evil.example", sentAt: 1_000 }), 1_001)?.next).toBe("/pipeline");
  });
});

describe("safeNextPath", () => {
  it("allows authenticated-area paths", () => {
    expect(safeNextPath("/approvals")).toBe("/approvals");
    expect(safeNextPath("/documents/0b5c8a1e-1111-4111-8111-111111111111")).toBe("/documents/0b5c8a1e-1111-4111-8111-111111111111");
    expect(safeNextPath("/pipeline?stage=closing")).toBe("/pipeline?stage=closing");
    expect(safeNextPath("/portal")).toBe("/portal");
  });

  it.each([
    ["absolute URL", "https://evil.example/pipeline"],
    ["protocol-relative", "//evil.example/pipeline"],
    ["backslash", "/\\evil.example"],
    ["traversal", "/pipeline/../../etc"],
    ["javascript", "javascript:alert(1)"],
    ["public page", "/about"],
    ["sign-in loop", "/login"],
    ["empty", ""],
    ["too long", `/pipeline/${"a".repeat(600)}`],
  ])("falls back for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/pipeline");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath(null, "/portal")).toBe("/portal");
  });
});
