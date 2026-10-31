import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRoutable, checkRoute, guardedModelCall, prepareForRoute, providerForModel, routeCeiling, RoutingRefusedError } from "./routing";

const borrowerRow = {
  contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "415-555-0100" },
  intake: { assetType: "ASSISTED_LIVING", loanAmount: 2_500_000, noi: 420_000 },
};

afterEach(() => vi.restoreAllMocks());

describe("providerForModel", () => {
  it.each([
    ["claude-opus-5-5", "anthropic"],
    ["claude-haiku-5-5", "anthropic"],
    ["us.anthropic.claude-sonnet-5-5", "anthropic"],
    ["grok-4", "xai"],
    ["xai/grok-4-fast", "xai"],
    ["nvidia/llama-3.3-nemotron-super-49b-v1", "nvidia"],
    ["meta/llama-3.1-70b-instruct", "nvidia"],
    ["gpt-5", null],
    ["", null],
  ])("%s → %s", (model, provider) => {
    expect(providerForModel(model)).toBe(provider);
  });
});

describe("xAI never receives borrower data", () => {
  it("refuses a borrower record", () => {
    const d = checkRoute({ model: "grok-4", purpose: "market_intel", payload: borrowerRow, table: "leads" });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("borrower_data_to_xai");
  });

  it("refuses an email or phone hidden in free text", () => {
    for (const text of ["Draft a note for pat@example.com", "Summarize LA multifamily; call 415-555-0100"]) {
      const d = checkRoute({ model: "grok-4", purpose: "market_intel", payload: { prompt: text }, declared: { level: "public" } });
      expect(d.allowed, text).toBe(false);
      expect(d.reasons).toContain("borrower_data_to_xai");
    }
  });

  it("refuses deal numbers and declared borrower categories", () => {
    expect(checkRoute({ model: "grok-4", purpose: "market_intel", payload: { loanAmount: 4_000_000 }, declared: { level: "public" } }).allowed).toBe(false);
    const d = checkRoute({ model: "grok-4", purpose: "market_intel", payload: "Context", declared: { level: "public", categories: ["borrower"] } });
    expect(d.reasons).toContain("borrower_data_to_xai");
  });

  it("refuses anything above public, even for other purposes", () => {
    const d = checkRoute({ model: "grok-4", purpose: "drafting", payload: "Internal pipeline summary" });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("exceeds_provider_ceiling");
  });

  it("allows declared-public market signals", () => {
    const d = checkRoute({
      model: "grok-4",
      purpose: "market_intel",
      payload: { prompt: "Summarize this week's public news on Southern California hotel CMBS delinquencies and 10-year Treasury moves." },
      declared: { level: "public" },
    });
    expect(d).toMatchObject({ allowed: true, provider: "xai", level: "public", reasons: [] });
  });
});

describe("market-intel models never receive restricted fields", () => {
  it("refuses restricted data on Claude for market intel", () => {
    const d = checkRoute({ model: "claude-sonnet-5-5", purpose: "market_intel", payload: { note: "guarantor SSN 123-45-6789" }, declared: { level: "public" } });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toEqual(expect.arrayContaining(["restricted_not_allowed", "forbidden_category_for_purpose"]));
  });

  it("refuses borrower records for market intel on any provider", () => {
    for (const model of ["claude-opus-5-5", "nvidia/llama-3.3-nemotron-super-49b-v1", "grok-4"]) {
      expect(checkRoute({ model, purpose: "market_intel", payload: borrowerRow, table: "leads" }).allowed, model).toBe(false);
    }
  });

  it("has an internal ceiling at most", () => {
    expect(routeCeiling("anthropic", "market_intel")).toBe("internal");
    expect(routeCeiling("xai", "market_intel")).toBe("public");
  });
});

describe("restricted data", () => {
  const pfs = { principal: { ssn: "123-45-6789", dob: "1971-04-12" }, assets: 4_000_000 };

  it("goes only to Claude for document extraction", () => {
    expect(checkRoute({ model: "claude-opus-5-5", purpose: "document_extraction", payload: pfs }).allowed).toBe(true);
    expect(checkRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: pfs }).reasons).toContain("restricted_not_allowed");
    expect(checkRoute({ model: "nvidia/llama-3.3-nemotron-super-49b-v1", purpose: "document_extraction", payload: pfs }).allowed).toBe(false);
    expect(routeCeiling("anthropic", "document_extraction")).toBe("restricted");
    expect(routeCeiling("anthropic", "advisor")).toBe("confidential");
    expect(routeCeiling("nvidia", "document_extraction")).toBe("confidential");
  });

  it("lets the advisor send borrower deal context to Claude", () => {
    expect(checkRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: borrowerRow, table: "leads" }).allowed).toBe(true);
  });
});

describe("fail-closed cases", () => {
  it("treats unknown models as public-only", () => {
    const d = checkRoute({ model: "gpt-5", purpose: "advisor", payload: "hello" });
    expect(d.reasons).toEqual(expect.arrayContaining(["unknown_provider", "exceeds_provider_ceiling"]));
  });

  it("rejects a provider that disagrees with the model id", () => {
    expect(checkRoute({ model: "grok-4", provider: "anthropic", purpose: "advisor", payload: "x" }).reasons).toContain("provider_model_mismatch");
  });

  it("honors a subject's AI processing opt-out", () => {
    const d = checkRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: borrowerRow, table: "leads", subject: { aiProcessingOptOut: true } });
    expect(d.reasons).toContain("subject_opted_out");
    // Questions with no personal data still work.
    expect(checkRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: "What is HUD 223(f)?", subject: { aiProcessingOptOut: true } }).allowed).toBe(true);
  });
});

describe("assertRoutable / prepareForRoute / guardedModelCall", () => {
  it("throws with the decision and logs no values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let err: unknown;
    try {
      assertRoutable({ model: "grok-4", purpose: "market_intel", payload: borrowerRow, table: "leads" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RoutingRefusedError);
    expect((err as RoutingRefusedError).decision.reasons).toContain("borrower_data_to_xai");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("pat@example.com");
    expect(logged).not.toContain("415-555-0100");
  });

  it("redacts what it can for the advisor", () => {
    const prepared = prepareForRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: { messages: [{ role: "user", content: "My SSN is 123-45-6789, can I refinance?" }] } });
    expect(prepared?.payload.messages[0]?.content).toBe("My SSN is [REDACTED:ssn], can I refinance?");
    expect(prepared?.decision.allowed).toBe(true);
  });

  it("returns null when redaction cannot make the route safe", () => {
    expect(prepareForRoute({ model: "claude-opus-5-5", purpose: "advisor", payload: borrowerRow, table: "leads", subject: { aiProcessingOptOut: true } })).toBeNull();
  });

  it("never calls the model when refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(async () => "sent");
    await expect(guardedModelCall({ model: "grok-4", purpose: "market_intel", payload: borrowerRow, table: "leads" }, send)).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(send).not.toHaveBeenCalled();
    await expect(guardedModelCall({ model: "claude-haiku-5-5", purpose: "classification", payload: "Classify: T-12 attached" }, send)).resolves.toBe("sent");
  });
});
