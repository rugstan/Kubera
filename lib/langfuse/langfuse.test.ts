import { describe, expect, it, vi } from "vitest";
import { langfuseConfigFromEnv, LangfuseTracer, scrubForTrace } from "./index";

function capture() {
  const bodies: { url: string; auth: string; body: { batch: { type: string; body: Record<string, unknown> }[] } }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    bodies.push({ url, auth: (init.headers as Record<string, string>).authorization!, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 207 });
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe("Langfuse tracer", () => {
  it("is disabled without both keys and requires https", () => {
    expect(langfuseConfigFromEnv({})).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk" })).toBeNull();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://evil.test" })).toBeNull();
    expect(langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" })).toMatchObject({ baseUrl: "https://us.cloud.langfuse.com", captureContent: false });
  });

  it("sends metadata only by default", async () => {
    const { bodies, fetchImpl } = capture();
    const t = new LangfuseTracer({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.test", captureContent: false, fetch: fetchImpl });
    const trace = t.trace({ id: "run-1", name: "mail.classify", input: { email: "pat@example.com" } });
    trace.generation({ name: "g", model: "claude-haiku-5-5", provider: "anthropic", startTime: new Date(0), endTime: new Date(5), input: "Pat Lee pat@example.com", output: "x", usage: { inputTokens: 3, outputTokens: 1 } });
    await t.flush();
    expect(bodies[0]!.url).toBe("https://lf.test/api/public/ingestion");
    expect(bodies[0]!.auth).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
    const [traceEvt, genEvt] = bodies[0]!.body.batch;
    expect(traceEvt!.type).toBe("trace-create");
    expect(traceEvt!.body.input).toBeUndefined();
    expect(genEvt!.body).toMatchObject({ traceId: "run-1", model: "claude-haiku-5-5", usage: { input: 3, output: 1, unit: "TOKENS" } });
    expect(genEvt!.body.input).toBeUndefined();
    expect(JSON.stringify(bodies)).not.toContain("pat@example.com");
  });

  it("redacts PII even when content capture is on", async () => {
    const { bodies, fetchImpl } = capture();
    const t = new LangfuseTracer({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.test", captureContent: true, fetch: fetchImpl });
    t.trace({ name: "x", input: { note: "call 415-555-0100 or pat@example.com, SSN 123-45-6789" } });
    await t.flush();
    const sent = JSON.stringify(bodies);
    expect(sent).not.toContain("pat@example.com");
    expect(sent).not.toContain("123-45-6789");
    expect(scrubForTrace("rate is 6.1%")).toBe("rate is 6.1%");
  });

  it("never throws when ingestion fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = new LangfuseTracer({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.test", captureContent: false, fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    t.trace({ name: "x" });
    await expect(t.flush()).resolves.toBeUndefined();
  });
});
