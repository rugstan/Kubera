"use client";

import { useSyncExternalStore } from "react";

// Tracks whether the Ask Kubera AI backend is reachable and configured. When
// /api/ask reports 503 (no model key) every AI entry point hides itself:
//   - React: useAskAvailable()
//   - CSS:   html[data-ask="off"] [data-ask-entry] { display: none }  (globals.css)
// Any component, including ones owned by other teams, can opt in by adding the
// data-ask-entry attribute to its "Ask Kubera AI" control.

export type AskAvailability = "unknown" | "available" | "unavailable";

const STORAGE_KEY = "kubera:ask-availability";
const TTL_MS = 10 * 60_000;

let state: AskAvailability = "unknown";
let hydrated = false;
const listeners = new Set<() => void>();

function readCache(): AskAvailability {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return "unknown";
    const parsed = JSON.parse(raw) as { value?: AskAvailability; at?: number };
    if (parsed.value && typeof parsed.at === "number" && Date.now() - parsed.at < TTL_MS && (parsed.value === "available" || parsed.value === "unavailable")) {
      return parsed.value;
    }
  } catch {
    // storage blocked or corrupt: ignore
  }
  return "unknown";
}

function writeCache(value: AskAvailability) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ value, at: Date.now() }));
  } catch {
    // storage blocked: the in-memory state still works
  }
}

function set(next: AskAvailability) {
  if (next === state) return;
  state = next;
  if (typeof document !== "undefined") {
    if (next === "unavailable") document.documentElement.dataset.ask = "off";
    else delete document.documentElement.dataset.ask;
  }
  for (const l of listeners) l();
}

export function getAskAvailability(): AskAvailability {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    const cached = readCache();
    if (cached !== "unknown") set(cached);
  }
  return state;
}

export function subscribeAskAvailability(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called when any /api/ask response is 503. */
export function markAskUnavailable() {
  writeCache("unavailable");
  set("unavailable");
}

export function markAskAvailable() {
  writeCache("available");
  set("available");
}

/** Test hook. */
export function resetAskAvailability() {
  hydrated = false;
  state = "unknown";
  listeners.clear();
  if (typeof document !== "undefined") delete document.documentElement.dataset.ask;
}

/**
 * Cheap, side-effect-free check. A GET never spends rate-limit budget or a model
 * call: 503 (or `{ available: false }`) means off; anything else, including the
 * 405 a POST-only route returns, means we assume on and learn from real use.
 */
export async function probeAskAvailability(fetchImpl: typeof fetch = fetch): Promise<AskAvailability> {
  try {
    const res = await fetchImpl("/api/ask", { method: "GET", cache: "no-store" });
    if (res.status === 503) {
      markAskUnavailable();
      return "unavailable";
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { available?: boolean } | null;
      if (body && body.available === false) {
        markAskUnavailable();
        return "unavailable";
      }
    }
    markAskAvailable();
    return "available";
  } catch {
    // Network failure says nothing about configuration; leave state alone.
    return state;
  }
}

/** True unless the backend has reported 503. Server render assumes true. */
export function useAskAvailable(): boolean {
  const value = useSyncExternalStore(subscribeAskAvailability, getAskAvailability, () => "unknown" as AskAvailability);
  return value !== "unavailable";
}
