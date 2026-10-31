import { sanitizeProps, scrubUrl, type AnalyticsEventName, type AnalyticsEvents, type AnalyticsProps } from "./events";

// Env-gated analytics client (Global rule 3): an interface, a real
// implementation (Vercel Web Analytics, cookieless) and an in-memory fake.
// With NEXT_PUBLIC_ANALYTICS unset nothing loads and nothing is sent.

export interface AnalyticsClient {
  readonly enabled: boolean;
  /** Loads the provider script once. Safe to call repeatedly. */
  start(): void;
  track<E extends AnalyticsEventName>(event: E, props: AnalyticsEvents[E]): void;
}

export type AnalyticsProvider = "vercel" | "off";

export function resolveProvider(raw: string | undefined): AnalyticsProvider {
  return raw?.trim().toLowerCase() === "vercel" ? "vercel" : "off";
}

type Nav = { globalPrivacyControl?: boolean; doNotTrack?: string | null };

/** Global Privacy Control is a legal opt-out signal in California; honour it even though nothing here is personal. */
export function optedOut(nav: Nav | undefined): boolean {
  if (!nav) return false;
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

export const noopAnalytics: AnalyticsClient = {
  enabled: false,
  start() {},
  track() {},
};

export type FakeAnalytics = AnalyticsClient & { events: { event: string; props: AnalyticsProps }[]; started: number };

export function createFakeAnalytics(): FakeAnalytics {
  const events: FakeAnalytics["events"] = [];
  const fake: FakeAnalytics = {
    enabled: true,
    events,
    started: 0,
    start() {
      fake.started += 1;
    },
    track(event, props) {
      events.push({ event, props: sanitizeProps(props) });
    },
  };
  return fake;
}

type VercelModule = Pick<typeof import("@vercel/analytics"), "inject" | "track">;

/** Vercel Web Analytics: cookieless, query strings stripped before anything leaves the browser. */
export function createVercelAnalytics(load: () => Promise<VercelModule> = () => import("@vercel/analytics"), nav?: Nav): AnalyticsClient {
  let mod: Promise<VercelModule> | null = null;
  const ensure = () => (mod ??= load());
  return {
    enabled: true,
    start() {
      if (optedOut(nav)) return;
      void ensure()
        .then((m) => m.inject({ beforeSend: (e) => ({ ...e, url: scrubUrl(e.url) }) }))
        .catch(() => {});
    },
    track(event, props) {
      if (optedOut(nav)) return;
      const clean = sanitizeProps(props);
      void ensure()
        .then((m) => m.track(event, clean))
        .catch(() => {});
    },
  };
}

let singleton: AnalyticsClient | null = null;

/** The client for this browser tab, chosen from NEXT_PUBLIC_ANALYTICS. */
export function analytics(): AnalyticsClient {
  if (singleton) return singleton;
  if (typeof window === "undefined" || resolveProvider(process.env.NEXT_PUBLIC_ANALYTICS) === "off") return noopAnalytics;
  singleton = createVercelAnalytics(undefined, window.navigator as Nav);
  return singleton;
}

/** Test seam: replace or clear the tab-wide client. */
export function setAnalyticsForTests(client: AnalyticsClient | null): void {
  singleton = client;
}

export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsEvents[E]): void {
  analytics().track(event, props);
}
