import { CloudflareTurnstileVerifier } from "./cloudflare";
import type { TurnstileVerifier } from "./types";

export * from "./types";

let instance: TurnstileVerifier | null | undefined;

/**
 * The configured verifier, or null when TURNSTILE_SECRET_KEY is unset
 * (local dev and previews). Callers treat null as "verification disabled".
 */
export function turnstileVerifier(): TurnstileVerifier | null {
  if (instance !== undefined) return instance;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret) {
    instance = new CloudflareTurnstileVerifier(secret);
  } else {
    console.warn("turnstile: TURNSTILE_SECRET_KEY not set; bot verification is disabled");
    instance = null;
  }
  return instance;
}

/** Test hook: inject a verifier (null disables, undefined re-reads env). */
export function setTurnstileVerifier(verifier: TurnstileVerifier | null | undefined) {
  instance = verifier;
}
