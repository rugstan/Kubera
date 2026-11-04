// Reason codes: short, stable, machine-readable explanations attached to every
// agent event (why a tool was blocked, why a lead got its tier, why a lender
// ranked where it did). Codes are lowercase dotted paths, e.g.
// `tool.out_of_scope` or `qualifier.tier.tier_2_qualified_midmarket`, and are
// what staff filter on and what reports count. Free text belongs in `detail`.

export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
export const MAX_REASON_CODES = 64;

/** Reasons the tool runner (lib/agents/core/tools.ts) attaches to its outcomes. */
export const TOOL_REASONS = {
  outOfScope: "tool.out_of_scope",
  unknownTool: "tool.unknown",
  invalidInput: "tool.invalid_input",
  custodyForbidden: "policy.custody_forbidden",
  autonomyAudit: "autonomy.audit_only",
  autonomyCapped: "autonomy.capped",
  taintedScope: "injection.tainted_scope",
  taintedNoAutomate: "injection.tainted_no_automate",
  recipientNotTrusted: "injection.recipient_not_trusted",
  approvalPending: "approval.pending",
  approvalRejected: "approval.rejected",
  approvalExpired: "approval.expired",
  approvalCancelled: "approval.cancelled",
  approvalConflict: "approval.idempotency_conflict",
  approvalUnavailable: "approval.gate_unavailable",
  approvalAuto: "approval.pre_approved_template",
  duplicateSuppressed: "approval.duplicate_suppressed",
  reauthRequired: "reauth.required",
  reauthVerified: "reauth.verified",
  auditUnavailable: "audit.log_unavailable",
  sendFailed: "tool.send_failed",
  /** Execution was claimed but never confirmed (crash or provider error mid-send): never retried automatically. */
  sendOutcomeUnknown: "tool.send_outcome_unknown",
  readExecuted: "tool.read_executed",
} as const;

/** Codes the injection scanner (lib/agents/core/injection.ts) emits, one per finding kind. */
export const INJECTION_REASONS = {
  overrideInstructions: "injection.override_instructions",
  roleImpersonation: "injection.role_impersonation",
  chatTemplateTokens: "injection.chat_template_tokens",
  blockEscape: "injection.block_escape",
  toolInvocation: "injection.tool_invocation",
  exfiltration: "injection.exfiltration",
  promptLeak: "injection.prompt_leak_request",
  credentialRequest: "injection.credential_request",
  fundsRedirect: "injection.funds_redirect",
  approvalBypass: "injection.approval_bypass",
  hiddenUnicode: "injection.hidden_unicode",
  hiddenInstructions: "injection.hidden_instructions",
  encodedPayload: "injection.encoded_payload",
  hiddenHtml: "injection.hidden_html",
  canaryLeak: "injection.canary_leak",
  urlNotAllowlisted: "injection.url_not_allowlisted",
  emailNotInContext: "injection.email_not_in_context",
} as const;

/** Codes the inbound guard (lib/agents/core/inbound.ts) adds on top of the per-finding codes. */
export const INBOUND_REASONS = {
  /** Instruction-like sentences were removed before the model saw the content. */
  stripped: "injection.instructions_stripped",
  /** A medium or high finding: the run is tainted (no automatic actions, trusted recipients only). */
  flagged: "injection.input_flagged",
} as const;

export function isReasonCode(code: string): boolean {
  return code.length <= 120 && REASON_CODE_PATTERN.test(code);
}

/** Turns arbitrary text (an enum value, a program id) into one code segment. */
export function codeSegment(value: string): string {
  const s = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!s) return "unknown";
  return /^[a-z]/.test(s) ? s : `x${s}`;
}

/** Validates, de-duplicates and caps a list of reason codes (invalid codes throw: they are programming errors). */
export function normalizeReasonCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    if (!isReasonCode(c)) throw new Error(`invalid reason code "${c}"`);
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_REASON_CODES);
}
