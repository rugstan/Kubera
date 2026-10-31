import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMS,
  EmbeddingError,
  EmbeddingRefusedError,
  FakeEmbeddings,
  NvidiaEmbeddings,
  VoyageEmbeddings,
  cosine,
  embedGuarded,
  embedQuery,
  embeddingClientFromEnv,
  fakeVector,
  toPgVector,
} from "./embeddings";

const vec = (seed: number) => Array.from({ length: EMBEDDING_DIMS }, (_, i) => ((i + seed) % 7) / 7);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const data = (n: number) => ({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: vec(index) })) });

describe("provider selection", () => {
  it("is off without keys", () => {
    expect(embeddingClientFromEnv({})).toBeNull();
    expect(embeddingClientFromEnv({ EMBEDDINGS_PROVIDER: "voyage" })).toBeNull();
    expect(embeddingClientFromEnv({ VOYAGE_API_KEY: "k", EMBEDDINGS_PROVIDER: "off" })).toBeNull();
  });

  it("prefers Voyage, then NVIDIA, unless told otherwise", () => {
    expect(embeddingClientFromEnv({ VOYAGE_API_KEY: "v", NVIDIA_API_KEY: "n" })?.provider).toBe("voyage");
    expect(embeddingClientFromEnv({ NVIDIA_API_KEY: "n" })?.provider).toBe("nvidia");
    expect(embeddingClientFromEnv({ VOYAGE_API_KEY: "v", NVIDIA_API_KEY: "n", EMBEDDINGS_PROVIDER: "nvidia" })?.provider).toBe("nvidia");
  });

  it("uses configurable model names", () => {
    expect(embeddingClientFromEnv({ VOYAGE_API_KEY: "v" })?.model).toBe("voyage-3.5");
    expect(embeddingClientFromEnv({ NVIDIA_API_KEY: "n" })?.model).toBe("nvidia/nv-embedqa-e5-v5");
    expect(embeddingClientFromEnv({ NVIDIA_API_KEY: "n", NVIDIA_EMBED_MODEL: "nvidia/other" })?.model).toBe("nvidia/other");
  });
});

describe("Voyage", () => {
  it("posts the documented request and returns vectors in input order", async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => jsonResponse({ data: [{ index: 1, embedding: vec(1) }, { index: 0, embedding: vec(0) }] }));
    const client = new VoyageEmbeddings({ apiKey: "vk", fetch });
    const out = await client.embed(["a", "b"], "document");
    expect(out).toEqual([vec(0), vec(1)]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer vk");
    expect(JSON.parse(String(init!.body))).toEqual({ input: ["a", "b"], model: "voyage-3.5", input_type: "document", output_dimension: 1024, truncation: true });
  });

  it("batches large inputs", async () => {
    const fetch = vi.fn(async (_u: unknown, init?: RequestInit) => jsonResponse(data(JSON.parse(String(init!.body)).input.length)));
    const out = await new VoyageEmbeddings({ apiKey: "vk", fetch }).embed(Array.from({ length: 150 }, (_, i) => `t${i}`), "query");
    expect(out).toHaveLength(150);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses to run without a key", async () => {
    const client = new VoyageEmbeddings({});
    expect(client.configured()).toBe(false);
    await expect(client.embed(["x"], "query")).rejects.toThrow(EmbeddingError);
  });
});

describe("NVIDIA NIM", () => {
  it("maps document/query to passage/query", async () => {
    const fetch = vi.fn(async (_u: unknown, _init?: RequestInit) => jsonResponse(data(1)));
    const client = new NvidiaEmbeddings({ apiKey: "nk", fetch, baseUrl: "https://nim.example/v1/" });
    await client.embed(["x"], "document");
    await client.embed(["x"], "query");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://nim.example/v1/embeddings");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({ model: "nvidia/nv-embedqa-e5-v5", input_type: "passage", encoding_format: "float", truncate: "END" });
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body)).input_type).toBe("query");
  });
});

describe("errors and retries", () => {
  const sleep = async () => {};

  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    const fetch = vi.fn(async () => (++n < 3 ? jsonResponse({ error: "slow down" }, 429) : jsonResponse(data(1))));
    const out = await new VoyageEmbeddings({ apiKey: "k", fetch, sleep }).embed(["x"], "query");
    expect(out).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 and keeps the input out of the message", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "bad input: SECRET TEXT" }, 400));
    const err = await new VoyageEmbeddings({ apiKey: "k", fetch, sleep }).embed(["SECRET TEXT"], "query").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as EmbeddingError).status).toBe(400);
    expect((err as Error).message).not.toContain("SECRET");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit on network errors", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(new NvidiaEmbeddings({ apiKey: "k", fetch, sleep, maxAttempts: 2 }).embed(["x"], "query")).rejects.toThrow(/request failed/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed vectors", async () => {
    const short = vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    await expect(new VoyageEmbeddings({ apiKey: "k", fetch: short, sleep }).embed(["x"], "query")).rejects.toThrow(/1024/);
    const count = vi.fn(async () => jsonResponse(data(2)));
    await expect(new VoyageEmbeddings({ apiKey: "k", fetch: count, sleep }).embed(["x"], "query")).rejects.toThrow(/2 embeddings for 1 inputs/);
  });
});

describe("fake embeddings", () => {
  it("is deterministic, normalized, and similar for shared words", () => {
    const a = fakeVector("HUD 232 minimum DSCR for refinance");
    expect(a).toHaveLength(EMBEDDING_DIMS);
    expect(fakeVector("HUD 232 minimum DSCR for refinance")).toEqual(a);
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
    const near = cosine(a, fakeVector("what is the HUD 232 DSCR"));
    const far = cosine(a, fakeVector("hotel franchise PIP renovation"));
    expect(near).toBeGreaterThan(far);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it("formats a pgvector literal", () => {
    expect(toPgVector([0.5, -1, 0.123456789])).toBe("[0.5,-1,0.1234568]");
  });
});

describe("routing guard", () => {
  it("redacts restricted values before the text leaves", async () => {
    const fake = new FakeEmbeddings();
    await embedGuarded(fake, ["My SSN is 123-45-6789, what loan fits?"], "query");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.texts[0]).not.toContain("123-45-6789");
    expect(fake.calls[0]!.kind).toBe("query");
  });

  it("sends nothing for a subject who opted out of AI processing", async () => {
    const fake = new FakeEmbeddings();
    await expect(embedGuarded(fake, ["Reach me at pat@example.com about a bridge loan"], "query", { subject: { aiProcessingOptOut: true } })).rejects.toThrow(EmbeddingRefusedError);
    expect(fake.calls).toHaveLength(0);
  });

  it("passes public knowledge-base text through untouched", async () => {
    const fake = new FakeEmbeddings();
    const text = "HUD 4232.1: Section 232 LEAN processing for refinance of existing facilities.";
    await embedGuarded(fake, [text], "document");
    expect(fake.calls[0]!.texts).toEqual([text]);
    expect(await embedGuarded(fake, [], "document")).toEqual([]);
  });
});

describe("embedQuery", () => {
  it("returns null when embeddings are off or the query is empty", async () => {
    expect(await embedQuery("anything", { client: null })).toBeNull();
    expect(await embedQuery("   ", { client: new FakeEmbeddings() })).toBeNull();
  });

  it("returns a vector and never throws when the provider fails", async () => {
    expect(await embedQuery("HUD DSCR", { client: new FakeEmbeddings() })).toHaveLength(EMBEDDING_DIMS);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { provider: "fake" as const, model: "m", configured: () => true, embed: async () => Promise.reject(new EmbeddingError("down")) };
    expect(await embedQuery("HUD DSCR", { client: failing })).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns null quietly when the guard refuses", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await embedQuery("email pat@example.com", { client: new FakeEmbeddings(), subject: { aiProcessingOptOut: true } })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });
});
