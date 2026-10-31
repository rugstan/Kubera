// Cloudflare Turnstile bot protection: shared types for the verifier client.

/** Actions the widgets declare; the server checks the token was minted for the same action. */
export const TURNSTILE_ACTIONS = ["qualify", "partners", "ask", "documents", "privacy"] as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];

/** Request header the browser sends the widget token in. */
export const TURNSTILE_HEADER = "x-turnstile-token";

export type TurnstileVerification =
  | { success: true; hostname?: string; action?: string; challengeTs?: string }
  | { success: false; errorCodes: string[] };

export type VerifyInput = {
  token: string;
  remoteIp?: string;
  /** Expected widget action; a token minted for another action is rejected. */
  action?: TurnstileAction;
  /** Hostnames the token may have been issued on. Empty = no hostname check. */
  allowedHostnames?: string[];
};

export interface TurnstileVerifier {
  verify(input: VerifyInput): Promise<TurnstileVerification>;
}
