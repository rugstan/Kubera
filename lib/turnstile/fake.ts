import type { TurnstileAction, TurnstileVerification, TurnstileVerifier, VerifyInput } from "./types";

/**
 * In-memory Turnstile for tests. Issue tokens with `issue()`; each token is
 * single-use and bound to an action, mirroring Cloudflare's semantics.
 */
export class FakeTurnstileVerifier implements TurnstileVerifier {
  private readonly tokens = new Map<string, TurnstileAction | undefined>();
  readonly calls: VerifyInput[] = [];

  issue(token: string, action?: TurnstileAction): string {
    this.tokens.set(token, action);
    return token;
  }

  async verify(input: VerifyInput): Promise<TurnstileVerification> {
    this.calls.push(input);
    if (!this.tokens.has(input.token)) return { success: false, errorCodes: ["invalid-input-response"] };
    const action = this.tokens.get(input.token);
    this.tokens.delete(input.token);
    if (input.action && action && action !== input.action) return { success: false, errorCodes: ["action-mismatch"] };
    return { success: true, action };
  }
}
