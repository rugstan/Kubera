import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartnerRegistration } from "@/lib/validation";
import { pushPartner, type CrmProgress } from "./twenty";

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
