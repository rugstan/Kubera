import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { intakeFromQuick, intakeSchema, type PartnerRegistration } from "@/lib/validation";
import { leadSourceLabel, pushLead, pushPartner, type CrmProgress } from "./twenty";

const reg = {
  partnerType: "VENDOR",
  contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "", company: "", consent: false },
  organization: "Acme Appraisal",
  services: ["PHASE_I_ESA"],
  markets: "CA",
} as unknown as PartnerRegistration;

type Call = { method: string; path: string };

function stubTwenty(opts: { lookup: () => Response }) {
  const calls: Call[] = [];
  vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
  vi.stubEnv("TWENTY_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname.replace(/^\/rest\//, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      if (method === "GET") return opts.lookup();
      if (method === "PATCH") return Response.json({ data: { updatePerson: { id: "p-1" } } });
      return Response.json({ data: { [`create${path}`]: { id: `${path}-id` } } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Twenty person upsert", () => {
  it.each([429, 500, 503])("fails the personId step on a %i lookup instead of creating a duplicate person", async (status) => {
    const calls = stubTwenty({ lookup: () => new Response("busy", { status }) });
    const saved: CrmProgress[] = [];
    await expect(pushPartner(reg, { onProgress: (p) => void saved.push(p) })).rejects.toMatchObject({ status });
    expect(calls.some((c) => c.method === "POST" && c.path === "people")).toBe(false);
    // The company step is checkpointed, so the retry resumes at the person.
    expect(saved.at(-1)).toEqual({ companyId: "companies-id" });
  });

  it("a retry from the checkpoint reuses the existing person and narrows it without creating", async () => {
    const calls = stubTwenty({ lookup: () => Response.json({ data: { people: [{ id: "p-1" }] } }) });
    const refs = await pushPartner(reg, { progress: { companyId: "companies-id" } });
    expect(refs.personId).toBe("p-1");
    expect(calls.some((c) => c.method === "POST" && c.path === "people")).toBe(false);
    expect(calls.some((c) => c.method === "PATCH" && c.path === "people/p-1")).toBe(true);
  });

  it("creates the person when the lookup succeeds with no match", async () => {
    const calls = stubTwenty({ lookup: () => Response.json({ data: { people: [] } }) });
    const refs = await pushPartner(reg);
    expect(refs.personId).toBe("people-id");
    expect(calls.filter((c) => c.method === "POST" && c.path === "people")).toHaveLength(1);
  });
});

describe("Twenty push for a financing-page lead", () => {
  const rates = { fiveYear: 4.0, tenYear: 4.25, sofr30: 4.0, prime: 7.0 };
  const intake = intakeFromQuick(
    { assetType: "OFFICE", transaction: "PURCHASE", loanAmount: 3_000_000, timelineDays: 90, notes: "", slug: "office-loans" },
    { slug: "office-loans", path: "/financing/office-loans", name: "Office building loans" },
  );
  const contact = { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "415-555-0100", company: "", consent: true };

  function captureTwenty() {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
    vi.stubEnv("TWENTY_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const path = url.pathname.replace(/^\/rest\//, "");
        if ((init?.method ?? "GET") === "GET") return Response.json({ data: { people: [] } });
        posts.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return Response.json({ data: { [`create${path}`]: { id: `${path}-id` } } });
      }),
    );
    return posts;
  }

  it("names the opportunity and the note after the property and the page, and marks it for broker review", async () => {
    const posts = captureTwenty();
    const jev = { ...decideWithRules(intake, rates), engine: "rules" as const, latencyMs: 1 };
    await pushLead(intake, contact, jev, { consentEventId: "consent-1" });
    const opportunity = posts.find((p) => p.path === "opportunities")!.body;
    expect(leadSourceLabel(intake)).toBe("Office — /financing/office-loans");
    expect(opportunity.name).toBe("Broker review · Office — /financing/office-loans · $3.00M");
    expect(opportunity.stage).toBe("QUALIFICATION");
    expect(String(opportunity.nextStep)).toMatch(/^Broker review: confirm NOI, value and units/);
    const note = posts.find((p) => p.path === "notes")!.body as { title: string; bodyV2: { markdown: string } };
    expect(note.title).toBe("Financing page lead — broker review — Office — /financing/office-loans");
    expect(note.bodyV2.markdown).toContain("- Financing page form: Office building loans — /financing/office-loans");
    expect(note.bodyV2.markdown).toContain("Transaction chosen: Purchase");
    expect(note.bodyV2.markdown).not.toContain("## Indicative structure");
  });

  it("names an advisor-only lead after its page too", async () => {
    const posts = captureTwenty();
    await pushLead(intake, { ...contact, consent: false }, null);
    expect(posts.find((p) => p.path === "opportunities")!.body.name).toBe("Advisor review · Office — /financing/office-loans · $3.00M");
    expect((posts.find((p) => p.path === "notes")!.body as { bodyV2: { markdown: string } }).bodyV2.markdown).toContain("## Source");
  });

  it("leaves qualifier leads named as before", async () => {
    const posts = captureTwenty();
    const full = intakeSchema.parse({ assetType: "OFFICE", transaction: "REFINANCE", loanAmount: 3_000_000, noi: 420_000, value: 5_000_000 });
    const jev = { ...decideWithRules(full, rates), engine: "rules" as const, latencyMs: 1 };
    await pushLead(full, contact, jev);
    expect(leadSourceLabel(full)).toBeNull();
    expect(String(posts.find((p) => p.path === "opportunities")!.body.name)).toMatch(/ · \$3\.00M · Office$/);
    expect((posts.find((p) => p.path === "notes")!.body as { title: string }).title).toMatch(/^Jev intake — /);
  });
});
