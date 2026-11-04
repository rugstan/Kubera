import { describe, expect, it } from "vitest";
import { buildSentryOptions, parseSampleRate } from "./sentry.options";
import { REDACTED, scrubBreadcrumb, scrubEvent, scrubSpan, scrubString, scrubUrl, scrubValue } from "./sentry.scrub";

describe("scrubString", () => {
  it("redacts emails, phone numbers, SSNs, long digit runs and credentials", () => {
    const text = "Lead pat.lee+test@example.com called (415) 555-0132 or 415-555-0199; SSN 123-45-6789; acct 123456789012; Authorization: Bearer abcdef1234567890";
    const out = scrubString(text);
    expect(out).not.toMatch(/example\.com|555-01|123-45-6789|123456789012|abcdef1234567890/);
    expect(out).toContain(REDACTED);
    expect(out).toContain("Lead");
  });

  it("redacts JWTs and vendor API keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    expect(scrubString(`token=${jwt}`)).not.toContain("eyJ");
    // Built at runtime so the fixture is never mistaken for a real key by secret scanners.
    const vendorKey = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");
    expect(scrubString(`key ${vendorKey}`)).not.toContain("abcdefghijklmnop");
  });

  it("leaves ordinary error text and short numbers alone", () => {
    const text = "TypeError: Cannot read properties of undefined (reading 'loanAmount') at line 482";
    expect(scrubString(text)).toBe(text);
  });

  it("truncates very long strings", () => {
    expect(scrubString("x".repeat(5_000)).length).toBeLessThan(2_100);
  });
});

describe("scrubUrl", () => {
  it("drops query strings and fragments", () => {
    expect(scrubUrl("https://corincommercial.com/express?email=a@b.co&token=abc#frag")).toBe("https://corincommercial.com/express");
    expect(scrubUrl("/partners")).toBe("/partners");
  });
});

describe("scrubValue", () => {
  it("redacts sensitive keys at any depth and keeps benign ones", () => {
    const out = scrubValue({
      route: "/api/qualify",
      contact: { firstName: "Pat", email: "pat@example.com" },
      nested: { list: [{ phone: "415-555-0132", loanAmount: 3_000_000, ssn: "123-45-6789" }] },
      password: "hunter2",
      apiKey: "abc",
      empty: "",
    }) as Record<string, any>;
    expect(out.route).toBe("/api/qualify");
    expect(out.contact).toBe(REDACTED);
    expect(out.nested.list[0]).toEqual({ phone: REDACTED, loanAmount: 3_000_000, ssn: REDACTED });
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.empty).toBe("");
  });

  it("keeps trace and span identifiers intact", () => {
    const ids = { trace_id: "a1234567890123456789b", span_id: "1234567890123456", event_id: "00112233445566778899aabbccddeeff" };
    expect(scrubValue(ids)).toEqual(ids);
  });

  it("survives circular structures and deep nesting", () => {
    const a: Record<string, unknown> = { name: "loop" };
    a.self = a;
    expect(() => scrubValue(a)).not.toThrow();
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    expect(() => scrubValue(deep)).not.toThrow();
  });
});

describe("scrubEvent", () => {
  const event = {
    event_id: "00112233445566778899aabbccddeeff",
    message: "Failed to push pat@example.com to CRM",
    user: { id: "u1", email: "pat@example.com", ip_address: "203.0.113.9" },
    transaction: "POST /api/qualify?utm=1",
    request: {
      url: "https://corincommercial.com/api/qualify?email=pat@example.com",
      method: "POST",
      data: { contact: { email: "pat@example.com" }, intake: { loanAmount: 3_000_000 } },
      cookies: { session: "abc" },
      query_string: "email=pat@example.com",
      headers: { "user-agent": "Mozilla/5.0", cookie: "session=abc", authorization: "Bearer abcdefghijkl", "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
    },
    exception: { values: [{ type: "Error", value: "Twenty POST /people failed for 415-555-0132", stacktrace: { frames: [{ filename: "app/api/qualify/route.ts", vars: { contact: { email: "x@y.co" } } }] } }] },
    breadcrumbs: [{ category: "console", message: "email pat@example.com" }],
    extra: { intake: { loanAmount: 1 }, note: "call 415-555-0132" },
    tags: { route: "/api/qualify" },
  };

  it("removes the user, request body, cookies and sensitive headers", () => {
    const out = scrubEvent(event) as any;
    expect(out.user).toBeUndefined();
    expect(out.request.data).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.query_string).toBeUndefined();
    expect(out.request.url).toBe("https://corincommercial.com/api/qualify");
    expect(out.request.headers).toEqual({ "user-agent": "Mozilla/5.0", "content-type": "application/json" });
    expect(out.transaction).toBe("POST /api/qualify");
  });

  it("scrubs free text and nested exception data", () => {
    const out = scrubEvent(event) as any;
    expect(JSON.stringify(out)).not.toMatch(/pat@example\.com|415-555-0132|x@y\.co|203\.0\.113\.9|abcdefghijkl/);
    expect(out.exception.values[0].stacktrace.frames[0].filename).toBe("app/api/qualify/route.ts");
    expect(out.extra.intake).toBe(REDACTED);
    expect(out.tags.route).toBe("/api/qualify");
    expect(out.event_id).toBe(event.event_id);
  });

  it("does not mutate the original event", () => {
    const before = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("scrubBreadcrumb", () => {
  it("drops raw input capture", () => {
    expect(scrubBreadcrumb({ category: "ui.input", message: "body > input#email" })).toBeNull();
  });

  it("strips URL queries and request bodies from fetch breadcrumbs", () => {
    const out = scrubBreadcrumb({ category: "fetch", data: { url: "/api/qualify?email=a@b.co", body: "{\"x\":1}", status_code: 200 } }) as any;
    expect(out.data).toEqual({ url: "/api/qualify", status_code: 200 });
  });
});

describe("scrubSpan", () => {
  it("strips queries from names and URL attributes and drops bodies and headers", () => {
    const span = {
      trace_id: "a1234567890123456789b",
      span_id: "1234567890123456",
      name: "GET /api/rates?email=pat@example.com",
      attributes: {
        "url.full": { value: "https://corincommercial.com/express?phone=415-555-0132", type: "string" },
        "http.request.body.size": 120,
        "http.request.header.cookie": "session=abc",
        "http.response.status_code": 200,
        "user.email": "pat@example.com",
      },
    };
    const out = scrubSpan(span) as any;
    expect(out.name).toBe("GET /api/rates");
    expect(out.trace_id).toBe(span.trace_id);
    expect(out.attributes["url.full"].value).toBe("https://corincommercial.com/express");
    expect(out.attributes["http.response.status_code"]).toBe(200);
    expect(out.attributes["user.email"]).toBe(REDACTED);
    expect(out.attributes).not.toHaveProperty("http.request.header.cookie");
    expect(out.attributes).not.toHaveProperty("http.request.body.size");
  });
});

describe("buildSentryOptions", () => {
  it("is null without a usable DSN so Sentry never initialises", () => {
    expect(buildSentryOptions({})).toBeNull();
    expect(buildSentryOptions({ dsn: "  " })).toBeNull();
    expect(buildSentryOptions({ dsn: "not-a-dsn" })).toBeNull();
  });

  it("builds PII-safe options when a DSN is present", () => {
    const o = buildSentryOptions({ dsn: "https://key@o1.ingest.sentry.io/2", environment: "production", release: "abc123", tracesSampleRate: "0.25" });
    expect(o).toMatchObject({ dsn: "https://key@o1.ingest.sentry.io/2", environment: "production", release: "abc123", sendDefaultPii: false, tracesSampleRate: 0.25 });
    expect(o?.beforeSend).toBe(scrubEvent);
    expect(o?.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(o?.beforeSendSpan).toBe(scrubSpan);
  });

  it("falls back to a safe sample rate on bad input", () => {
    expect(parseSampleRate(undefined)).toBe(0.1);
    expect(parseSampleRate("2")).toBe(0.1);
    expect(parseSampleRate("abc")).toBe(0.1);
    expect(parseSampleRate("0")).toBe(0);
  });
});
