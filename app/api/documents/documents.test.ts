// Route tests for the document vault: mint -> upload -> finalize -> scan -> staff download,
// with the in-memory store, storage, scanner, rate limiter and Turnstile. Staff
// routes run through the real staff session check (lib/auth/dal) against
// injected fake auth services and a cookie jar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));
const afterCallbacks: (() => Promise<void> | void)[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void> | void) => void afterCallbacks.push(fn),
  connection: async () => undefined,
}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: { maxAge: number }) => {
      if (opts.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
}));

const { MemoryRateLimiter, setRateLimiter } = await import("@/lib/ratelimit");
const { FakeTurnstileVerifier } = await import("@/lib/turnstile/fake");
const { setTurnstileVerifier } = await import("@/lib/turnstile");
const { signLeadToken } = await import("@/lib/security");
const { setDocumentServices } = await import("@/lib/documents/server");
const { LEAD_ID, PDF_BYTES, PNG_BYTES, makeVault } = await import("@/lib/documents/testing");
const { QUARANTINE_BUCKET, VAULT_BUCKET } = await import("@/lib/documents/types");
const { MemoryAuditSink } = await import("@/lib/auth/audit");
const { MemoryDirectory } = await import("@/lib/auth/directory");
const { FakeAuthProvider } = await import("@/lib/auth/fake-provider");
const { setAuthServices, sessionSigningKey } = await import("@/lib/auth/server");
const { SESSION_COOKIE, encodeSession, toStored } = await import("@/lib/auth/session");
const { totp } = await import("@/lib/auth/totp");
type Role = import("@/lib/auth/types").Role;

const mintRoute = await import("./route");
const finalizeRoute = await import("./finalize/route");
const scanRoute = await import("./scan/route");
const downloadRoute = await import("./[id]/download/route");
const deleteRoute = await import("./[id]/route");

const ORIGIN = "https://corincommercial.com";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

let provider: InstanceType<typeof FakeAuthProvider>;
let directory: InstanceType<typeof MemoryDirectory>;
const people = new Map<string, string>();

function addPerson(email: string, roles: Role[], opts: { totp?: boolean } = {}) {
  const u = provider.addUser({ email, totpSecret: opts.totp ? TOTP_SECRET : undefined });
  directory.set(
    { id: u.id, email, fullName: email.split("@")[0]!, title: null, active: true, dreLicenseNumber: null, dreLicenseType: null, dreLicenseExpiresOn: null, dreLicenseVerifiedAt: null },
    roles,
  );
  people.set(email, u.id);
}

/** Signs a person in (with TOTP when `mfa`) and stores their session cookie; null signs out. */
async function signInAs(email: string | null, mfa = true) {
  jar.clear();
  if (!email) return;
  await provider.sendEmailOtp(email, { redirectTo: `${ORIGIN}/auth/confirm` });
  let s = await provider.verifyEmailOtp(email, provider.lastEmailFor(email)!.code);
  if (mfa) {
    const [factor] = await provider.listTotpFactors(s);
    s = await provider.verifyTotp(s, factor!.id, totp(TOTP_SECRET, Date.now()));
  }
  jar.set(SESSION_COOKIE, encodeSession(toStored(s, Math.floor(Date.now() / 1000)), sessionSigningKey()));
}

let turnstile: InstanceType<typeof FakeTurnstileVerifier>;
let vault: ReturnType<typeof makeVault>;
let ip = 0;
let n = 0;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip % 250}`, ...headers },
    body: JSON.stringify(body),
  });
}

const mintBody = (over: Record<string, unknown> = {}) => ({
  leadId: LEAD_ID,
  token: signLeadToken(LEAD_ID),
  kind: "T12",
  fileName: "t12.pdf",
  contentType: "application/pdf",
  sizeBytes: PDF_BYTES.byteLength,
  ...over,
});

const mintHeaders = () => ({ "x-turnstile-token": turnstile.issue(`m${++n}`, "documents") });

async function mint(over: Record<string, unknown> = {}) {
  const res = await mintRoute.POST(post("/api/documents", mintBody(over), mintHeaders()));
  return { res, body: (await res.json()) as Record<string, string | number> };
}

beforeEach(() => {
  vi.stubEnv("LEAD_TOKEN_SECRET", "test-secret-test-secret");
  vi.stubEnv("CRON_SECRET", "cron-secret-cron-secret");
  vi.stubEnv("SCANNER_PROVIDER", "fake");
  jar.clear();
  people.clear();
  provider = new FakeAuthProvider();
  directory = new MemoryDirectory();
  setAuthServices({ mode: "fake", provider, directory, audit: new MemoryAuditSink(), userClient: () => null });
  addPerson("pat@corin.test", ["broker"], { totp: true });
  addPerson("alex@corin.test", ["analyst"], { totp: true });
  addPerson("bo@borrower.test", ["borrower"]);
  setRateLimiter(new MemoryRateLimiter());
  turnstile = new FakeTurnstileVerifier();
  setTurnstileVerifier(turnstile);
  vault = makeVault();
  setDocumentServices(vault.deps);
  afterCallbacks.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRateLimiter(undefined);
  setTurnstileVerifier(undefined);
  setDocumentServices(undefined);
  setAuthServices(undefined);
});

describe("POST /api/documents (mint)", () => {
  it("returns a signed URL into the quarantine bucket and an expiring upload token", async () => {
    const { res, body } = await mint();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ path: expect.stringContaining(`${LEAD_ID}/T12/`), maxBytes: PDF_BYTES.byteLength });
    expect(String(body.uploadUrl)).toContain(QUARANTINE_BUCKET);
    expect(String(body.uploadToken)).toMatch(/^v1\./);
    expect(body).not.toHaveProperty("ok");
  });

  it("keeps working for older clients that send no size", async () => {
    const { res, body } = await mint({ sizeBytes: undefined });
    expect(res.status).toBe(200);
    expect(body.maxBytes).toBe(50 * 1024 * 1024);
  });

  it("requires the lead capability token", async () => {
    const { res } = await mint({ token: "x".repeat(43) });
    expect(res.status).toBe(401);
    expect(vault.store.rows.size).toBe(0);
  });

  it("reports 503 when the vault is not configured, and maps validation failures", async () => {
    expect((await mint({ fileName: "t12.exe" })).res.status).toBe(400);
    expect((await mint({ contentType: "application/zip" })).res.status).toBe(400);
    const tooBig = await mint({ sizeBytes: 60 * 1024 * 1024 });
    expect(tooBig.res.status).toBe(413);
    expect(tooBig.body.code).toBe("file_too_large");
    setDocumentServices(null);
    expect((await mint()).res.status).toBe(503);
  });
});

describe("full upload flow", () => {
  it("mint, upload, finalize, scan, then a staff download", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PDF_BYTES);

    const fin = await finalizeRoute.POST(post("/api/documents/finalize", { documentId: body.documentId, token: body.uploadToken }));
    expect(fin.status).toBe(200);
    expect(await fin.json()).toEqual({ documentId: body.documentId, status: "quarantined" });
    expect(afterCallbacks).toHaveLength(1);

    // Quarantined: staff cannot download yet.
    await signInAs("alex@corin.test");
    const early = await downloadRoute.GET(new Request(`${ORIGIN}/x`), { params: Promise.resolve({ id: String(body.documentId) }) });
    expect(early.status).toBe(409);

    // The post-response scan runs.
    await afterCallbacks[0]!();
    expect((await vault.store.get(String(body.documentId)))!.status).toBe("clean");

    // A forged actor header is ignored: the audit names the signed-in staff member.
    const ok = await downloadRoute.GET(new Request(`${ORIGIN}/x?purpose=underwriting`, { headers: { "x-staff-actor": "someone-else" } }), {
      params: Promise.resolve({ id: String(body.documentId) }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ fileName: "t12.pdf", expiresInSeconds: 60, url: expect.stringContaining(VAULT_BUCKET) });
    expect(vault.events.events.find((e) => e.event === "download")).toMatchObject({
      actor: `staff:${people.get("alex@corin.test")}:alex@corin.test`,
      detail: { purpose: "underwriting" },
    });
    expect(vault.events.events.find((e) => e.event === "download")?.ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("POST /api/documents/finalize", () => {
  it("rejects an expired upload token with 401", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PDF_BYTES);
    vault.clock.advance(16 * 60);
    const res = await finalizeRoute.POST(post("/api/documents/finalize", { documentId: body.documentId, token: body.uploadToken }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("token_expired");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("rejects wrong magic bytes with 422 and removes the file", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PNG_BYTES);
    const res = await finalizeRoute.POST(post("/api/documents/finalize", { documentId: body.documentId, token: body.uploadToken }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("content_mismatch");
    expect(vault.storage.paths(QUARANTINE_BUCKET)).toEqual([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("is guarded like the other public endpoints (origin, content type, bad input)", async () => {
    const { body } = await mint();
    const payload = { documentId: body.documentId, token: body.uploadToken };
    expect((await finalizeRoute.POST(post("/api/documents/finalize", payload, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await finalizeRoute.POST(post("/api/documents/finalize", payload, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await finalizeRoute.POST(post("/api/documents/finalize", { documentId: "nope", token: "x" }))).status).toBe(400);
    setDocumentServices(null);
    expect((await finalizeRoute.POST(post("/api/documents/finalize", payload))).status).toBe(503);
  });

  it("rate limits per IP", async () => {
    const { body } = await mint();
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) {
      statuses.push((await finalizeRoute.POST(post("/api/documents/finalize", { documentId: body.documentId, token: body.uploadToken }, { "x-forwarded-for": "203.0.113.9" }))).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("staff routes", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const del = (path = "/x", headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { method: "DELETE", headers });
  const id = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a11";

  it("refuses signed-out callers and the retired shared bearer token", async () => {
    vi.stubEnv("DOCUMENT_STAFF_TOKEN", "s".repeat(40));
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx(id))).status).toBe(401);
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`, { headers: { authorization: `Bearer ${"s".repeat(40)}`, "x-staff-actor": "pat" } }), ctx(id))).status).toBe(401);
    expect((await deleteRoute.DELETE(del("/x", { authorization: `Bearer ${"s".repeat(40)}` }), ctx(id))).status).toBe(401);
  });

  it("requires MFA and a staff role", async () => {
    await signInAs("pat@corin.test", false);
    const noMfa = await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx(id));
    expect(noMfa.status).toBe(403);
    expect((await noMfa.json()).code).toBe("mfa_required");
    expect((await deleteRoute.DELETE(del(), ctx(id))).status).toBe(403);
    await signInAs("bo@borrower.test", false);
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx(id))).status).toBe(403);
    expect((await deleteRoute.DELETE(del(), ctx(id))).status).toBe(403);
  });

  it("answers 503 when staff sign-in is not configured", async () => {
    setAuthServices(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx(id))).status).toBe(503);
    expect((await deleteRoute.DELETE(del(), ctx(id))).status).toBe(503);
  });

  it("answers 404 for unknown or malformed ids and audits nothing sensitive", async () => {
    await signInAs("alex@corin.test");
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx("not-a-uuid"))).status).toBe(404);
    expect((await downloadRoute.GET(new Request(`${ORIGIN}/x`), ctx(id))).status).toBe(404);
  });

  it("lets only brokers and admins delete, and refuses cross-site requests", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PDF_BYTES);
    const docId = String(body.documentId);
    await signInAs("alex@corin.test");
    const analyst = await deleteRoute.DELETE(del(), ctx(docId));
    expect(analyst.status).toBe(403);
    expect((await analyst.json()).code).toBe("forbidden");
    await signInAs("pat@corin.test");
    expect((await deleteRoute.DELETE(del("/x", { origin: "https://evil.example" }), ctx(docId))).status).toBe(403);
    expect(vault.store.rows.size).toBe(1);
    expect(vault.events.events.some((e) => e.event === "deleted")).toBe(false);
  });

  it("deletes a document with its file, refuses one on legal hold, and audits both", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PDF_BYTES);
    const docId = String(body.documentId);
    await signInAs("pat@corin.test");

    vault.store.rows.get(docId)!.legal_hold = true;
    const held = await deleteRoute.DELETE(del("/x", { origin: ORIGIN }), ctx(docId));
    expect(held.status).toBe(423);
    expect(vault.storage.has(QUARANTINE_BUCKET, String(body.path))).toBe(true);

    vault.store.rows.get(docId)!.legal_hold = false;
    const gone = await deleteRoute.DELETE(del("/x?reason=borrower%20request", { "x-staff-actor": "someone-else" }), ctx(docId));
    expect(gone.status).toBe(200);
    expect(vault.storage.paths(QUARANTINE_BUCKET)).toEqual([]);
    expect(vault.store.rows.size).toBe(0);
    expect(vault.events.events.find((e) => e.event === "deleted")).toMatchObject({
      actor: `staff:${people.get("pat@corin.test")}:pat@corin.test`,
      detail: { reason: "borrower request" },
    });
  });
});

describe("/api/documents/scan", () => {
  const cron = (secret = "cron-secret-cron-secret") => new Request(`${ORIGIN}/api/documents/scan`, { headers: { authorization: `Bearer ${secret}` } });

  it("requires the cron secret", async () => {
    expect((await scanRoute.GET(cron("wrong"))).status).toBe(401);
    expect((await scanRoute.GET(new Request(`${ORIGIN}/api/documents/scan`))).status).toBe(401);
  });

  it("scans a batch and reports it", async () => {
    const { body } = await mint();
    vault.storage.upload(QUARANTINE_BUCKET, String(body.path), PDF_BYTES);
    vault.clock.advance(60); // the sweep finalizes uploads whose browser never called finalize
    const res = await scanRoute.GET(cron());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, claimed: 1, clean: 1, sweep: { finalized: 1 } });
  });

  it("skips quietly when Supabase is not configured", async () => {
    setDocumentServices(null);
    expect(await (await scanRoute.GET(cron())).json()).toEqual({ ok: true, skipped: "supabase-not-configured" });
  });
});
