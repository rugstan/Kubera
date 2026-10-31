// Route tests for the privacy endpoints and the retention cron, with the
// in-memory privacy database and storage fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const { MemoryRateLimiter, setRateLimiter } = await import("@/lib/ratelimit");
const { MemoryPrivacyDb } = await import("@/lib/privacy/fake");
const { MemoryObjectStorage } = await import("@/lib/privacy/storage");
const { setPrivacyServices } = await import("@/lib/privacy/server");
const { submitPrivacyRequest } = await import("@/lib/privacy/requests");

const intake = await import("./request/route");
const action = await import("./request/[id]/route");
const exporter = await import("./request/[id]/export/route");
const hold = await import("./legal-hold/route");
const cron = await import("../cron/retention/route");

const ORIGIN = "https://kuberacommercial.com";
const ADMIN = "a".repeat(40);
const LEAD = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";

let db: InstanceType<typeof MemoryPrivacyDb>;
let storage: InstanceType<typeof MemoryObjectStorage>;
let ip = 0;

function install(tokenOk = false) {
  setPrivacyServices({
    requests: db,
    subjects: db,
    retention: db,
    storage,
    legalHolds: db,
    verifyLeadToken: () => tokenOk,
    leadEmail: async (id) => (db.find("leads", id)?.contact as { email?: string } | undefined)?.email ?? null,
  });
}

beforeEach(() => {
  db = new MemoryPrivacyDb();
  storage = new MemoryObjectStorage();
  setRateLimiter(new MemoryRateLimiter());
  install();
  vi.stubEnv("PRIVACY_ADMIN_TOKEN", ADMIN);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  setPrivacyServices(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const body = { type: "access", name: "Pat Lee", email: "pat@example.com", attest: true };

function post(payload: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/privacy/request`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "user-agent": "vitest", "x-forwarded-for": `203.0.113.${++ip % 250}`, ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const admin = (path: string, init: RequestInit = {}, token = ADMIN) =>
  new Request(`${ORIGIN}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/privacy/request", () => {
  it("rejects forged origins, wrong content types and invalid bodies", async () => {
    expect((await intake.POST(post(body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await intake.POST(post(body, { "content-type": "text/plain" }))).status).toBe(415);
    const bad = await intake.POST(post({ ...body, attest: false }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe("attest");
    expect(db.rows("privacy_requests")).toHaveLength(0);
  });

  it("files a ticket in the compliance queue and returns no personal data", async () => {
    const res = await intake.POST(post(body));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, type: "access", status: "pending_verification" });
    expect(json.message).toMatch(/verify your identity/);
    expect(JSON.stringify(json)).not.toContain("pat@example.com");
    expect(db.rows("privacy_requests")[0]).toMatchObject({ queue: "compliance", subject_email: "pat@example.com", ip_hash: expect.any(String) });
    // Same-day resubmission returns the same ticket.
    const again = await intake.POST(post(body));
    expect(again.status).toBe(200);
    expect((await again.json()).reference).toBe(json.reference);
  });

  it("verifies with the qualifier's lead token", async () => {
    install(true);
    db.insertRow("leads", { id: LEAD, created_at: new Date().toISOString(), contact: { email: "pat@example.com" } });
    const res = await intake.POST(post({ ...body, type: "deletion", leadId: LEAD, leadToken: "t".repeat(43) }));
    expect((await res.json()).status).toBe("verified");
  });

  it("applies a human-review opt-out immediately", async () => {
    const res = await intake.POST(post({ ...body, type: "human_review" }));
    expect((await res.json()).status).toBe("completed");
    expect(await db.getPreferences("pat@example.com")).toMatchObject({ human_review_only: true, ai_processing_opt_out: true });
  });

  it("rate limits", async () => {
    const headers = { "x-forwarded-for": "198.51.100.77" };
    for (let i = 0; i < 5; i++) await intake.POST(post({ ...body, email: `p${i}@example.com` }, headers));
    expect((await intake.POST(post(body, headers))).status).toBe(429);
  });

  it("degrades to 503 with the privacy email when storage is not configured", async () => {
    setPrivacyServices(null);
    const res = await intake.POST(post(body));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/privacy@/);
  });
});

describe("admin endpoints", () => {
  async function ticket(type: "access" | "deletion" = "access") {
    return submitPrivacyRequest({ type, name: "Pat", email: "pat@example.com", phone: "", relationship: "self", attest: true }, { store: db });
  }

  it("are disabled without a strong token and reject a wrong one", async () => {
    const t = await ticket();
    vi.stubEnv("PRIVACY_ADMIN_TOKEN", "short");
    expect((await exporter.GET(admin(`/api/privacy/request/${t.id}/export`), ctx(t.id))).status).toBe(503);
    vi.stubEnv("PRIVACY_ADMIN_TOKEN", ADMIN);
    expect((await exporter.GET(admin(`/api/privacy/request/${t.id}/export`, {}, "b".repeat(40)), ctx(t.id))).status).toBe(401);
    expect((await action.GET(admin(`/api/privacy/request/${t.id}`, {}, "b".repeat(40)), ctx(t.id))).status).toBe(401);
    expect((await hold.POST(admin("/api/privacy/legal-hold", { method: "POST", body: "{}" }, "b".repeat(40)))).status).toBe(401);
  });

  it("export only after verification, then records the hash", async () => {
    db.insertRow("leads", { id: LEAD, created_at: "2026-11-01T00:00:00Z", contact: { email: "pat@example.com" }, intake: { assetType: "HOTEL" }, decision: {}, rationale: [] });
    const t = await ticket();
    const early = await exporter.GET(admin(`/api/privacy/request/${t.id}/export`), ctx(t.id));
    expect(early.status).toBe(409);

    const verify = await action.POST(admin(`/api/privacy/request/${t.id}`, { method: "POST", body: JSON.stringify({ action: "verify", by: "J. Rivera" }) }), ctx(t.id));
    expect(verify.status).toBe(200);
    expect((await verify.json()).request.status).toBe("verified");

    const res = await exporter.GET(admin(`/api/privacy/request/${t.id}/export`), ctx(t.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const doc = await res.json();
    expect(doc.records.leads[0].id).toBe(LEAD);
    const row = await db.get(t.id);
    expect(row).toMatchObject({ status: "in_progress", export_sha256: res.headers.get("x-export-sha256") });

    const done = await action.POST(admin(`/api/privacy/request/${t.id}`, { method: "POST", body: JSON.stringify({ action: "complete", by: "J. Rivera", note: "Sent via secure link" }) }), ctx(t.id));
    expect((await done.json()).request.status).toBe("completed");
  });

  it("refuses to export a deletion request or complete one by hand", async () => {
    const t = await ticket("deletion");
    await action.POST(admin(`/api/privacy/request/${t.id}`, { method: "POST", body: JSON.stringify({ action: "verify", by: "J. Rivera" }) }), ctx(t.id));
    expect((await exporter.GET(admin(`/api/privacy/request/${t.id}/export`), ctx(t.id))).status).toBe(409);
    const res = await action.POST(admin(`/api/privacy/request/${t.id}`, { method: "POST", body: JSON.stringify({ action: "complete", by: "J. Rivera" }) }), ctx(t.id));
    expect(res.status).toBe(409);
  });

  it("denies with a reason and 404s unknown ids", async () => {
    const t = await ticket();
    const res = await action.POST(admin(`/api/privacy/request/${t.id}`, { method: "POST", body: JSON.stringify({ action: "deny", by: "J. Rivera", reason: "Could not verify identity after two attempts" }) }), ctx(t.id));
    expect((await res.json()).request).toMatchObject({ status: "denied", denial_reason: expect.stringMatching(/verify/) });
    expect((await action.GET(admin(`/api/privacy/request/not-a-uuid`), ctx("not-a-uuid"))).status).toBe(404);
    expect((await action.GET(admin(`/api/privacy/request/${LEAD}`), ctx(LEAD))).status).toBe(404);
  });

  it("places and releases a legal hold", async () => {
    db.insertRow("leads", { id: LEAD, created_at: "2026-11-01T00:00:00Z", contact: { email: "pat@example.com" } });
    const place = await hold.POST(admin("/api/privacy/legal-hold", { method: "POST", body: JSON.stringify({ table: "leads", id: LEAD, hold: true, reason: "Litigation hold", actor: "Counsel" }) }));
    expect(place.status).toBe(200);
    expect(db.find("leads", LEAD)).toMatchObject({ legal_hold: true, legal_hold_reason: "Litigation hold" });
    const noReason = await hold.POST(admin("/api/privacy/legal-hold", { method: "POST", body: JSON.stringify({ table: "leads", id: LEAD, hold: true, actor: "Counsel" }) }));
    expect(noReason.status).toBe(400);
    const badTable = await hold.POST(admin("/api/privacy/legal-hold", { method: "POST", body: JSON.stringify({ table: "kb_chunks", id: LEAD, hold: true, reason: "x x x", actor: "Counsel" }) }));
    expect(badTable.status).toBe(400);
    const release = await hold.POST(admin("/api/privacy/legal-hold", { method: "POST", body: JSON.stringify({ table: "leads", id: LEAD, hold: false, actor: "Counsel" }) }));
    expect(release.status).toBe(200);
    expect(db.find("leads", LEAD)?.legal_hold).toBe(false);
  });
});

describe("GET /api/cron/retention", () => {
  const cronReq = (q = "", token = "cron-secret") => new Request(`${ORIGIN}/api/cron/retention${q}`, { headers: { authorization: `Bearer ${token}` } });

  it("requires the cron secret", async () => {
    expect((await cron.GET(cronReq("", "wrong"))).status).toBe(401);
  });

  it("skips when Supabase is not configured", async () => {
    setPrivacyServices(null);
    expect(await (await cron.GET(cronReq())).json()).toEqual({ ok: true, skipped: "supabase-not-configured" });
  });

  it("deletes expired rows and their storage objects, and works verified deletion requests", async () => {
    const old = db.insertRow("leads", { created_at: "2020-01-01T00:00:00Z", contact: { email: "old@example.com" } });
    const path = `${String(old.id)}/T12/t12.pdf`;
    storage.put("deal-documents", path);
    db.insertRow("documents", { lead_id: old.id, storage_path: path, kind: "T12", file_name: "t12.pdf" });

    const fresh = db.insertRow("leads", { created_at: new Date().toISOString(), contact: { email: "erase@example.com" } });
    const freshPath = `${String(fresh.id)}/PFS/pfs.pdf`;
    storage.put("deal-documents", freshPath);
    const t = await submitPrivacyRequest({ type: "deletion", name: "E", email: "erase@example.com", phone: "", relationship: "self", attest: true }, { store: db });
    await db.update(t.id, { status: "verified", verified_at: new Date().toISOString(), verification_method: "staff_match", verified_by: "J. Rivera" });

    const dry = await (await cron.GET(cronReq("?dryRun=1"))).json();
    expect(dry.dryRun).toBe(true);
    expect(storage.has("deal-documents", path)).toBe(true);

    const res = await cron.GET(cronReq());
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary.ok).toBe(true);
    expect(summary.deletionRequests).toMatchObject({ processed: 1, completed: 1 });
    expect(summary.policies.find((p: { policy: string }) => p.policy === "leads")).toMatchObject({ deleted: 1, objectsRemoved: 1 });
    expect(storage.has("deal-documents", path)).toBe(false);
    expect(storage.has("deal-documents", freshPath)).toBe(false);
    expect(db.rows("leads")).toHaveLength(0);
    expect((await db.get(t.id))?.status).toBe("completed");
  });
});
