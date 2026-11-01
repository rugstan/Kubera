// Route tests for the privacy endpoints and the retention cron, with the
// in-memory privacy database and storage fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

// Staff session (WS-I DAL) and step-up, scripted per test.
const staffForMutation = vi.fn();
const verifyStepUpTotp = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  staffForMutation: () => staffForMutation(),
  verifyStepUpTotp: (code: string) => verifyStepUpTotp(code),
  requestFingerprint: async () => ({ ipHash: "iphash", userAgent: "vitest" }),
}));
vi.mock("@/lib/auth/flows", () => ({ limited: async () => false }));

const { MemoryAuditSink } = await import("@/lib/auth/audit");
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
const LEAD = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";

let db: InstanceType<typeof MemoryPrivacyDb>;
let storage: InstanceType<typeof MemoryObjectStorage>;
let ip = 0;
let audit: InstanceType<typeof MemoryAuditSink>;

const ADMIN_ID = "0b6f2c1e-1111-4c39-9a55-3d3c1b7f2a10";
function signedIn(staffRoles: string[] = ["admin"]) {
  staffForMutation.mockResolvedValue({ ok: true, ctx: { principal: { userId: ADMIN_ID, email: "J.Rivera@Kuberacommercial.com", displayName: "J. Rivera", staffRoles }, accessToken: "t", services: { audit } } });
}

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
  audit = new MemoryAuditSink();
  staffForMutation.mockReset();
  verifyStepUpTotp.mockReset();
  signedIn();
  verifyStepUpTotp.mockImplementation(async (code: string) => (code === "123456" ? { ok: true, verifiedAt: new Date(), sessionRef: null } : { ok: false, reason: "invalid_code" }));
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

const admin = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, { ...init, headers: { origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) } });
const postJson = (path: string, payload: unknown, headers: Record<string, string> = {}) => admin(path, { method: "POST", body: JSON.stringify(payload), headers });
const exportReq = (id: string, totp?: string) => postJson(`/api/privacy/request/${id}/export`, totp === undefined ? {} : { totp });
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
  const verify = (id: string, extra: Record<string, unknown> = {}) => action.POST(postJson(`/api/privacy/request/${id}`, { action: "verify", ...extra }), ctx(id));

  it("require an admin staff session with MFA; the retired bearer token opens nothing", async () => {
    const t = await ticket();
    vi.stubEnv("PRIVACY_ADMIN_TOKEN", "a".repeat(40));
    const bearer = { authorization: `Bearer ${"a".repeat(40)}` };
    for (const denial of [
      { ok: false, status: 401, reason: "signed_out" },
      { ok: false, status: 403, reason: "mfa_required" },
      { ok: false, status: 503, reason: "unavailable" },
    ]) {
      staffForMutation.mockResolvedValue(denial);
      expect((await exporter.POST(postJson(`/api/privacy/request/${t.id}/export`, { totp: "123456" }, bearer), ctx(t.id))).status).toBe(denial.status);
      expect((await action.GET(admin(`/api/privacy/request/${t.id}`, { headers: bearer }), ctx(t.id))).status).toBe(denial.status);
      expect((await action.POST(postJson(`/api/privacy/request/${t.id}`, { action: "verify" }, bearer), ctx(t.id))).status).toBe(denial.status);
      expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: false }, bearer))).status).toBe(denial.status);
    }
    // Brokers and analysts are staff, but privacy requests are administrators' work.
    signedIn(["broker", "analyst"]);
    expect((await action.GET(admin(`/api/privacy/request/${t.id}`), ctx(t.id))).status).toBe(403);
    expect((await verify(t.id)).status).toBe(403);
    expect((await db.get(t.id))?.status).toBe("pending_verification");
    expect(audit.events).toHaveLength(0);
  });

  it("refuse cross-site mutations", async () => {
    const t = await ticket();
    const res = await action.POST(postJson(`/api/privacy/request/${t.id}`, { action: "verify" }, { origin: "https://evil.example" }), ctx(t.id));
    expect(res.status).toBe(403);
    expect((await db.get(t.id))?.status).toBe("pending_verification");
  });

  it("export only after verification, with a step-up code, recording who pulled it before returning data", async () => {
    db.insertRow("leads", { id: LEAD, created_at: "2026-11-01T00:00:00Z", contact: { email: "pat@example.com" }, intake: { assetType: "HOTEL" }, decision: {}, rationale: [] });
    const t = await ticket();
    expect((await exporter.POST(exportReq(t.id, "123456"), ctx(t.id))).status).toBe(409);

    // The verifier is the signed-in admin; a `by` in the body is ignored.
    const v = await verify(t.id, { by: "Somebody Else" });
    expect(v.status).toBe(200);
    const verified = (await v.json()).request;
    expect(verified).toMatchObject({ status: "verified", verified_by: `staff:j.rivera@kuberacommercial.com:${ADMIN_ID}` });
    expect(audit.events.at(-1)).toMatchObject({ action: "privacy.verify", actorId: ADMIN_ID, actorLabel: "j.rivera@kuberacommercial.com", targetType: "privacy_request", targetId: t.id, ipHash: "iphash" });

    // No code, or a wrong one: no export, no data, the failed attempt is audited.
    const noCode = await exporter.POST(exportReq(t.id), ctx(t.id));
    expect(noCode.status).toBe(401);
    expect((await noCode.json()).stepUp).toBe("totp_required");
    const wrong = await exporter.POST(exportReq(t.id, "000000"), ctx(t.id));
    expect(wrong.status).toBe(401);
    expect(audit.events.at(-1)).toMatchObject({ action: "privacy.step_up_failed", detail: { for: "privacy.export", reason: "invalid_code" } });
    expect(audit.events.some((e) => e.action === "privacy.export")).toBe(false);
    expect((await db.get(t.id))?.export_sha256 ?? null).toBeNull();
    // GET no longer exports.
    expect((await exporter.GET()).status).toBe(405);

    const res = await exporter.POST(exportReq(t.id, "123456"), ctx(t.id));
    expect(res.status).toBe(200);
    expect(verifyStepUpTotp).toHaveBeenLastCalledWith("123456");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const doc = await res.json();
    expect(doc.records.leads[0].id).toBe(LEAD);
    const row = await db.get(t.id);
    expect(row).toMatchObject({ status: "in_progress", export_sha256: res.headers.get("x-export-sha256"), resolution: { exportedBy: `staff:j.rivera@kuberacommercial.com:${ADMIN_ID}` } });
    expect(audit.events.filter((e) => e.action === "privacy.export")).toEqual([expect.objectContaining({ actorId: ADMIN_ID, targetId: t.id })]);

    const done = await action.POST(postJson(`/api/privacy/request/${t.id}`, { action: "complete", note: "Sent via secure link" }), ctx(t.id));
    expect((await done.json()).request).toMatchObject({ status: "completed", resolution: { completedBy: `staff:j.rivera@kuberacommercial.com:${ADMIN_ID}` } });
  });

  it("fails closed when the audit trail cannot be written: no export, no change", async () => {
    const t = await ticket();
    await verify(t.id);
    audit.failNext = true;
    const res = await exporter.POST(exportReq(t.id, "123456"), ctx(t.id));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("pat@example.com");
    expect((await db.get(t.id))?.export_sha256 ?? null).toBeNull();

    const other = await ticket("deletion");
    audit.failNext = true;
    expect((await verify(other.id)).status).toBe(503);
    expect((await db.get(other.id))?.status).toBe("pending_verification");

    audit.failNext = true;
    expect((await action.GET(admin(`/api/privacy/request/${t.id}`), ctx(t.id))).status).toBe(503);
  });

  it("refuses to export a deletion request or complete one by hand", async () => {
    const t = await ticket("deletion");
    await verify(t.id);
    expect((await exporter.POST(exportReq(t.id, "123456"), ctx(t.id))).status).toBe(409);
    const res = await action.POST(postJson(`/api/privacy/request/${t.id}`, { action: "complete" }), ctx(t.id));
    expect(res.status).toBe(409);
    expect(audit.events.some((e) => e.action === "privacy.complete")).toBe(false);
  });

  it("denies with a reason and 404s unknown ids", async () => {
    const t = await ticket();
    const res = await action.POST(postJson(`/api/privacy/request/${t.id}`, { action: "deny", reason: "Could not verify identity after two attempts" }), ctx(t.id));
    expect((await res.json()).request).toMatchObject({ status: "denied", denial_reason: expect.stringMatching(/verify/), resolution: { deniedBy: `staff:j.rivera@kuberacommercial.com:${ADMIN_ID}` } });
    expect((await action.GET(admin(`/api/privacy/request/not-a-uuid`), ctx("not-a-uuid"))).status).toBe(404);
    expect((await action.GET(admin(`/api/privacy/request/${LEAD}`), ctx(LEAD))).status).toBe(404);
  });

  it("places a legal hold as the signed-in admin and releases it only with a step-up code", async () => {
    db.insertRow("leads", { id: LEAD, created_at: "2026-11-01T00:00:00Z", contact: { email: "pat@example.com" } });
    const place = await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: true, reason: "Litigation hold", actor: "Counsel" }));
    expect(place.status).toBe(200);
    expect(db.find("leads", LEAD)).toMatchObject({ legal_hold: true, legal_hold_reason: "Litigation hold", legal_hold_set_by: `staff:j.rivera@kuberacommercial.com:${ADMIN_ID}` });
    expect(audit.events.at(-1)).toMatchObject({ action: "privacy.legal_hold_set", actorId: ADMIN_ID, targetType: "leads", targetId: LEAD, detail: { hold: true, reason: "Litigation hold" } });
    expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: true }))).status).toBe(400);
    expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "kb_chunks", id: LEAD, hold: true, reason: "x x x" }))).status).toBe(400);

    expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: false }))).status).toBe(401);
    expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: false, totp: "999999" }))).status).toBe(401);
    expect(db.find("leads", LEAD)?.legal_hold).toBe(true);
    audit.failNext = true;
    expect((await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: false, totp: "123456" }))).status).toBe(503);
    expect(db.find("leads", LEAD)?.legal_hold).toBe(true);

    const release = await hold.POST(postJson("/api/privacy/legal-hold", { table: "leads", id: LEAD, hold: false, totp: "123456" }));
    expect(release.status).toBe(200);
    expect(db.find("leads", LEAD)?.legal_hold).toBe(false);
    expect(audit.events.at(-1)).toMatchObject({ action: "privacy.legal_hold_release", actorId: ADMIN_ID, targetId: LEAD });
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
