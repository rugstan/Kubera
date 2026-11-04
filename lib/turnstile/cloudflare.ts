import { randomUUID } from "node:crypto";
import type { TurnstileVerification, TurnstileVerifier, VerifyInput } from "./types";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Turnstile tokens are at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;

type SiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
};

/** Server-side token validation against Cloudflare's siteverify endpoint. */
export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify({ token, remoteIp, action, allowedHostnames = [] }: VerifyInput): Promise<TurnstileVerification> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return { success: false, errorCodes: ["invalid-input-response"] };

    let body: SiteverifyResponse;
    try {
      const res = await this.fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: this.secret,
          response: token,
          ...(remoteIp && remoteIp !== "unknown" ? { remoteip: remoteIp } : {}),
          // Lets a retried siteverify call succeed for the same token.
          idempotency_key: randomUUID(),
        }),
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      if (!res.ok) return { success: false, errorCodes: [`http-${res.status}`] };
      body = (await res.json()) as SiteverifyResponse;
    } catch (err) {
      console.error("turnstile siteverify failed", err instanceof Error ? err.message : err);
      return { success: false, errorCodes: ["internal-error"] };
    }

    if (!body.success) return { success: false, errorCodes: body["error-codes"] ?? ["unknown"] };
    if (action && body.action && body.action !== action) return { success: false, errorCodes: ["action-mismatch"] };
    if (allowedHostnames.length && body.hostname && !allowedHostnames.includes(body.hostname.toLowerCase())) {
      return { success: false, errorCodes: ["hostname-mismatch"] };
    }
    return { success: true, hostname: body.hostname, action: body.action, challengeTs: body.challenge_ts };
  }
}
