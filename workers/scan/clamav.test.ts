import { describe, expect, it } from "vitest";
import { ClamAvRestScanner, clamAvConfigFromEnv } from "./clamav";

const config = { baseUrl: "https://clamav.internal:9000", scanPath: "/scan", timeoutMs: 5_000 };
const bytes = new TextEncoder().encode("hello");

function scannerReturning(status: number, body: unknown, captured: { url?: string; init?: RequestInit }[] = []) {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return new ClamAvRestScanner({ ...config, apiKey: "k" }, fetchImpl);
}

describe("ClamAvRestScanner", () => {
  it("posts the file as multipart with the bearer key and reports clean", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const verdict = await scannerReturning(200, { Status: "OK", Description: "" }, seen).scan(bytes, "t12.pdf");
    expect(verdict).toEqual({ status: "clean", engine: "clamav-rest" });
    expect(seen[0]!.url).toBe("https://clamav.internal:9000/scan");
    expect(seen[0]!.init?.method).toBe("POST");
    expect((seen[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer k");
    const form = seen[0]!.init?.body as FormData;
    expect((form.get("file") as File).name).toBe("t12.pdf");
  });

  it("reports infected on 406/FOUND and on 200 with an infected result", async () => {
    expect(await scannerReturning(406, { Status: "FOUND", Description: "Eicar-Signature" }).scan(bytes, "x")).toEqual({ status: "infected", engine: "clamav-rest", signature: "Eicar-Signature" });
    expect(await scannerReturning(200, [{ Status: "FOUND", Description: "Win.Test.EICAR_HDB-1" }]).scan(bytes, "x")).toMatchObject({ status: "infected", signature: "Win.Test.EICAR_HDB-1" });
    expect(await scannerReturning(200, { success: true, data: { result: [{ name: "x", is_infected: true, viruses: ["Eicar-Signature"] }] } }).scan(bytes, "x")).toMatchObject({ status: "infected", signature: "Eicar-Signature" });
    expect(await scannerReturning(200, { success: true, data: { result: [{ name: "x", is_infected: false, viruses: [] }] } }).scan(bytes, "x")).toMatchObject({ status: "clean" });
  });

  it("fails closed on anything it does not understand", async () => {
    for (const [status, body] of [
      [500, { Status: "OK" }],
      [413, "too large"],
      [200, "<html>proxy error</html>"],
      [200, {}],
      [200, { Status: "ERROR", Description: "lstat failed" }],
      [200, []],
      [406, { Status: "OK" }],
    ] as const) {
      expect((await scannerReturning(status, body).scan(bytes, "x")).status).toBe("error");
    }
  });

  it("reports an unreachable scanner as an error", async () => {
    const down = new ClamAvRestScanner(config, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(await down.scan(bytes, "x")).toMatchObject({ status: "error", message: expect.stringContaining("unreachable") });
  });
});

describe("clamAvConfigFromEnv", () => {
  it("is null without a URL and normalizes the rest", () => {
    expect(clamAvConfigFromEnv({})).toBeNull();
    expect(clamAvConfigFromEnv({ CLAMAV_REST_URL: "https://c.internal/", CLAMAV_REST_SCAN_PATH: "api/v1/scan", CLAMAV_REST_TIMEOUT_MS: "1500" })).toEqual({
      baseUrl: "https://c.internal",
      scanPath: "/api/v1/scan",
      apiKey: undefined,
      timeoutMs: 1500,
    });
  });
});
