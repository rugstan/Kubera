import { describe, expect, it, vi } from "vitest";
import { createFakeAnalytics, createVercelAnalytics, noopAnalytics, optedOut, resolveProvider, setAnalyticsForTests, track } from "./client";
import { EVENT_NAMES, sanitizeProps, scrubUrl } from "./events";

describe("sanitizeProps", () => {
  it("keeps primitives, drops objects and undefined, truncates long strings", () => {
    const out = sanitizeProps({ step: 2, asset: "MULTIFAMILY", ok: true, none: null, obj: { a: 1 }, arr: [1], gone: undefined, long: "x".repeat(200), nan: Number.NaN });
    expect(out).toEqual({ step: 2, asset: "MULTIFAMILY", ok: true, none: null, long: "x".repeat(60) });
  });

  it("strips anything that looks like personal or deal data", () => {
    const out = sanitizeProps({ email: "a@b.co", phone: "415", firstName: "Pat", loanAmount: 3_000_000, noi: 1, notes: "text", step: 1 });
    expect(out).toEqual({ step: 1 });
  });

  it("copes with no props", () => {
    expect(sanitizeProps(undefined)).toEqual({});
  });
});

describe("scrubUrl", () => {
  it("removes query strings and fragments, which can carry deal numbers", () => {
    expect(scrubUrl("https://kuberacommercial.com/express?asset=SNF&loan=5000000&noi=300000#x")).toBe("https://kuberacommercial.com/express");
    expect(scrubUrl("/express?loan=5000000")).toBe("/express");
  });
});

describe("event catalog", () => {
  it("has no event whose name suggests personal data", () => {
    for (const name of EVENT_NAMES) expect(name).not.toMatch(/email|phone|name$/);
  });

  it("lists every event once", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    expect(EVENT_NAMES).toContain("home_cta_clicked");
  });

  it("keeps the homepage CTA's properties through the sanitizer", () => {
    // `cta` and `section` must not trip the personal-data key filter, or the event arrives empty.
    expect(sanitizeProps({ cta: "get_options", section: "hero" })).toEqual({ cta: "get_options", section: "hero" });
    const fake = createFakeAnalytics();
    setAnalyticsForTests(fake);
    track("home_cta_clicked", { cta: "family_options", section: "programs" });
    setAnalyticsForTests(null);
    expect(fake.events).toEqual([{ event: "home_cta_clicked", props: { cta: "family_options", section: "programs" } }]);
  });
});

describe("providers", () => {
  it("is off unless explicitly set to vercel", () => {
    expect(resolveProvider(undefined)).toBe("off");
    expect(resolveProvider("")).toBe("off");
    expect(resolveProvider("posthog")).toBe("off");
    expect(resolveProvider(" Vercel ")).toBe("vercel");
  });

  it("honours Global Privacy Control and Do Not Track", () => {
    expect(optedOut({ globalPrivacyControl: true })).toBe(true);
    expect(optedOut({ doNotTrack: "1" })).toBe(true);
    expect(optedOut({ doNotTrack: "0" })).toBe(false);
    expect(optedOut(undefined)).toBe(false);
  });

  it("the no-op client does nothing", () => {
    expect(noopAnalytics.enabled).toBe(false);
    expect(() => noopAnalytics.track("sizer_see_all_clicked", {})).not.toThrow();
  });

  it("the fake records sanitized events and counts starts", () => {
    const fake = createFakeAnalytics();
    fake.start();
    fake.track("partner_submitted", { type: "VENDOR", consent: true });
    expect(fake.started).toBe(1);
    expect(fake.events).toEqual([{ event: "partner_submitted", props: { type: "VENDOR", consent: true } }]);
  });

  it("track() routes through the tab-wide client", () => {
    const fake = createFakeAnalytics();
    setAnalyticsForTests(fake);
    track("qualifier_step_viewed", { step: 2, asset: "SNF" });
    setAnalyticsForTests(null);
    expect(fake.events).toHaveLength(1);
  });
});

describe("Vercel client", () => {
  const mod = () => {
    const inject = vi.fn();
    const trackFn = vi.fn();
    return { inject, track: trackFn, load: async () => ({ inject, track: trackFn }) as never };
  };

  it("loads the script with a beforeSend that strips query strings", async () => {
    const m = mod();
    const client = createVercelAnalytics(m.load);
    client.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(m.inject).toHaveBeenCalledTimes(1);
    const { beforeSend } = m.inject.mock.calls[0]![0];
    expect(beforeSend({ type: "pageview", url: "https://kuberacommercial.com/express?loan=5000000" })).toEqual({ type: "pageview", url: "https://kuberacommercial.com/express" });
  });

  it("sends sanitized custom events", async () => {
    const m = mod();
    const client = createVercelAnalytics(m.load);
    client.track("qualifier_failed", { reason: "server", status: 500 });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.track).toHaveBeenCalledWith("qualifier_failed", { reason: "server", status: 500 });
  });

  it("sends nothing when the visitor has opted out", async () => {
    const m = mod();
    const client = createVercelAnalytics(m.load, { globalPrivacyControl: true });
    client.start();
    client.track("sizer_see_all_clicked", {});
    await new Promise((r) => setTimeout(r, 0));
    expect(m.inject).not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalled();
  });
});
