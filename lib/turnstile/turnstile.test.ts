import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareTurnstileVerifier } from "./cloudflare";
import { FakeTurnstileVerifier } from "./fake";
import { setTurnstileVerifier, turnstileVerifier } from "./index";

const siteverify = (body: Record<string, unknown>, status = 200) =>
  vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("CloudflareTurnstileVerifier", () => {
  it("posts secret, token and remote IP to siteverify", async () => {
    const fetchImpl = siteverify({ success: true, hostname: "kuberacommercial.com", action: "qualify" });
    const v = new CloudflareTurnstileVerifier("sekret", fetchImpl as unknown as typeof fetch);
    const r = await v.verify({ token: "tok", remoteIp: "1.2.3.4", action: "qualify", allowedHostnames: ["kuberacommercial.com"] });
    expect(r.success).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ secret: "sekret", response: "tok", remoteip: "1.2.3.4" });
    expect(typeof sent.idempotency_key).toBe("string");
  });

  it("rejects failed, mismatched-action and wrong-hostname tokens", async () => {
    const failed = new CloudflareTurnstileVerifier("s", siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }) as unknown as typeof fetch);
    expect(await failed.verify({ token: "t" })).toEqual({ success: false, errorCodes: ["timeout-or-duplicate"] });

    const wrongAction = new CloudflareTurnstileVerifier("s", siteverify({ success: true, action: "ask" }) as unknown as typeof fetch);
    expect((await wrongAction.verify({ token: "t", action: "qualify" })).success).toBe(false);

    const wrongHost = new CloudflareTurnstileVerifier("s", siteverify({ success: true, hostname: "evil.example" }) as unknown as typeof fetch);
    expect((await wrongHost.verify({ token: "t", allowedHostnames: ["kuberacommercial.com"] })).success).toBe(false);
  });

  it("fails closed on empty/oversized tokens, HTTP errors and network errors", async () => {
    const fetchImpl = siteverify({ success: true });
    const v = new CloudflareTurnstileVerifier("s", fetchImpl as unknown as typeof fetch);
    expect((await v.verify({ token: "" })).success).toBe(false);
    expect((await v.verify({ token: "x".repeat(2049) })).success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    const http = new CloudflareTurnstileVerifier("s", siteverify({}, 502) as unknown as typeof fetch);
    expect((await http.verify({ token: "t" })).success).toBe(false);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = new CloudflareTurnstileVerifier("s", (async () => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch);
    expect((await net.verify({ token: "t" })).success).toBe(false);
    spy.mockRestore();
  });
});

describe("FakeTurnstileVerifier", () => {
  it("accepts issued tokens once, for the right action", async () => {
    const fake = new FakeTurnstileVerifier();
    fake.issue("good", "qualify");
    expect((await fake.verify({ token: "good", action: "qualify" })).success).toBe(true);
    expect((await fake.verify({ token: "good", action: "qualify" })).success).toBe(false);
    fake.issue("other", "ask");
    expect((await fake.verify({ token: "other", action: "qualify" })).success).toBe(false);
    expect((await fake.verify({ token: "never-issued" })).success).toBe(false);
  });
});

describe("turnstileVerifier()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setTurnstileVerifier(undefined);
  });

  it("is disabled without a secret and real with one", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    setTurnstileVerifier(undefined);
    expect(turnstileVerifier()).toBeNull();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    setTurnstileVerifier(undefined);
    expect(turnstileVerifier()).toBeInstanceOf(CloudflareTurnstileVerifier);
    spy.mockRestore();
  });
});
