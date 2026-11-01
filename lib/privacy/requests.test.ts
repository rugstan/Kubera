import { describe, expect, it, vi } from "vitest";
import { MemoryPrivacyDb } from "./fake";
import {
  dedupeKey,
  isActionable,
  markVerified,
  privacyRequestSchema,
  PrivacyRequestStateError,
  requestDeadlines,
  routingSubject,
  submitPrivacyRequest,
  type PrivacyRequestStore,
} from "./requests";

const NOW = new Date("2026-11-20T18:00:00Z"); // Friday before Thanksgiving week, Pacific time
const LEAD = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";
const base = { name: "Pat Lee", email: "Pat@Example.com", attest: true as const };

function deps(db: MemoryPrivacyDb, tokenOk = false, leadEmail: string | null = "pat@example.com") {
  return { store: db, now: () => NOW, verifyLeadToken: vi.fn(() => tokenOk), leadEmail: vi.fn(async () => leadEmail) };
}

describe("schema", () => {
  it("requires attestation, an agent name for agents, and details for corrections", () => {
    expect(privacyRequestSchema.safeParse({ ...base, type: "access" }).success).toBe(true);
    expect(privacyRequestSchema.safeParse({ ...base, type: "access", attest: false }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...base, type: "access", relationship: "authorized_agent" }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...base, type: "access", relationship: "authorized_agent", agentName: "Lee Law LLP" }).success).toBe(true);
    expect(privacyRequestSchema.safeParse({ ...base, type: "correction" }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...base, type: "erase-everything" }).success).toBe(false);
    expect(privacyRequestSchema.safeParse({ ...base, type: "access", email: "nope" }).success).toBe(false);
  });
});

describe("deadlines", () => {
  it("acknowledges within 10 business days and responds within 45 calendar days", () => {
    const d = requestDeadlines(NOW);
    expect(d.receivedOn).toBe("2026-11-20");
    // Skips Thanksgiving (Nov 26). The day after (a California-only holiday) counts
    // as a business day on the default, strictest federal-only calendar.
    expect(d.acknowledgeBy).toBe("2026-12-07");
    expect(d.dueAt).toBe("2027-01-04");
  });
});

describe("submitPrivacyRequest", () => {
  it("queues an access request for verification in the compliance queue", async () => {
    const db = new MemoryPrivacyDb();
    const r = await submitPrivacyRequest({ ...base, type: "access", phone: "", relationship: "self" }, deps(db), { ipHash: "h", userAgent: "ua" });
    expect(r).toMatchObject({ status: "pending_verification", verified: false, duplicate: false, dueAt: "2027-01-04" });
    const row = await db.get(r.id);
    expect(row).toMatchObject({
      queue: "compliance",
      mailbox: "compliance@kuberacommercial.com",
      subject_email: "pat@example.com",
      verification_method: null,
      verified_at: null,
      lead_id: null,
      ip_hash: "h",
    });
  });

  it("verifies with a valid lead token whose email matches", async () => {
    const db = new MemoryPrivacyDb();
    const d = deps(db, true);
    const r = await submitPrivacyRequest({ ...base, type: "deletion", phone: "", relationship: "self", leadId: LEAD, leadToken: "t".repeat(43) }, d);
    expect(r).toMatchObject({ status: "verified", verified: true });
    expect(d.verifyLeadToken).toHaveBeenCalledWith(LEAD, "t".repeat(43));
    expect(await db.get(r.id)).toMatchObject({ verification_method: "lead_token", lead_id: LEAD });
  });

  it("does not verify on a bad token, a different email, or an agent", async () => {
    for (const [tokenOk, email, relationship] of [
      [false, "pat@example.com", "self"],
      [true, "other@example.com", "self"],
      [true, "pat@example.com", "authorized_agent"],
    ] as const) {
      const db = new MemoryPrivacyDb();
      const r = await submitPrivacyRequest(
        { ...base, type: "access", phone: "", relationship, agentName: relationship === "authorized_agent" ? "Agent" : undefined, leadId: LEAD, leadToken: "t".repeat(43) },
        deps(db, tokenOk, email),
      );
      expect(r.status, `${tokenOk} ${email} ${relationship}`).toBe("pending_verification");
      expect((await db.get(r.id))?.lead_id).toBeNull();
    }
  });

  it("applies a human-review opt-out immediately and the routing subject reflects it", async () => {
    const db = new MemoryPrivacyDb();
    expect(await routingSubject(db, "pat@example.com")).toEqual({ aiProcessingOptOut: false, humanReviewOnly: false });
    const r = await submitPrivacyRequest({ ...base, type: "human_review", phone: "", relationship: "self" }, deps(db));
    expect(r).toMatchObject({ status: "completed", verified: true });
    expect(await db.getPreferences("pat@example.com")).toMatchObject({ human_review_only: true, ai_processing_opt_out: true, source_request_id: r.id });
    expect(await routingSubject(db, "PAT@example.com")).toEqual({ aiProcessingOptOut: true, humanReviewOnly: true });
    const row = await db.get(r.id);
    expect(row).toMatchObject({ verification_method: "not_required", completed_at: NOW.toISOString() });
  });

  it("records an opt-out of sale/sharing without touching AI preferences", async () => {
    const db = new MemoryPrivacyDb();
    await submitPrivacyRequest({ ...base, type: "opt_out_sale_share", phone: "", relationship: "self" }, deps(db));
    expect(await db.getPreferences("pat@example.com")).toMatchObject({ opt_out_sale_share: true, ai_processing_opt_out: false });
  });

  it("returns the same ticket for a same-day resubmission", async () => {
    const db = new MemoryPrivacyDb();
    const a = await submitPrivacyRequest({ ...base, type: "access", phone: "", relationship: "self" }, deps(db));
    const b = await submitPrivacyRequest({ ...base, email: "pat@example.com", type: "access", phone: "", relationship: "self" }, deps(db));
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(db.rows("privacy_requests")).toHaveLength(1);
    expect(dedupeKey("access", "a@b.co", "2026-11-20")).not.toBe(dedupeKey("deletion", "a@b.co", "2026-11-20"));
  });
});

describe("verification by staff", () => {
  it("moves pending → verified once, and only from pending", async () => {
    const db = new MemoryPrivacyDb();
    const r = await submitPrivacyRequest({ ...base, type: "access", phone: "", relationship: "self" }, deps(db));
    expect(isActionable((await db.get(r.id))!)).toBe(false);
    const v = await markVerified(db, r.id, "J. Rivera", NOW);
    expect(v).toMatchObject({ status: "verified", verification_method: "staff_match", verified_by: "J. Rivera" });
    expect(isActionable((await db.get(r.id))!)).toBe(true);
    await expect(markVerified(db, r.id, "J. Rivera")).rejects.toBeInstanceOf(PrivacyRequestStateError);
    await expect(markVerified(db, "missing", "J. Rivera")).rejects.toThrow(/not found/);
  });
});

describe("routingSubject", () => {
  it("is permissive when no store exists and fails closed when the lookup errors", async () => {
    expect(await routingSubject(null, "a@b.co")).toEqual({ aiProcessingOptOut: false, humanReviewOnly: false });
    expect(await routingSubject(new MemoryPrivacyDb(), null)).toEqual({ aiProcessingOptOut: false, humanReviewOnly: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { getPreferences: async () => Promise.reject(new Error("down")) } as unknown as PrivacyRequestStore;
    expect(await routingSubject(broken, "a@b.co")).toEqual({ aiProcessingOptOut: true, humanReviewOnly: true });
  });
});
