// Stage keys, labels and per-program stage order shared by the deal desk's
// stage templates (./stages.ts) and the staff pipeline (client and server).
// Pure data: no Node APIs, so client components can import it.

import type { DealProgram } from "./types";

/** Every stage key the templates use, in lifecycle order (also the pipeline's sort order). */
export const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  engaged: "Engaged",
  packaging: "Packaging",
  lender_outreach: "Lender outreach",
  term_sheet: "Term sheet",
  application: "Lender application",
  third_party_reports: "Third-party reports",
  plan_and_cost_review: "Plan and cost review",
  hud_review: "HUD review",
  firm_commitment: "Firm commitment",
  lender_underwriting: "Lender underwriting",
  sba_authorization: "SBA authorization",
  underwriting: "Underwriting",
  commitment: "Commitment",
  closing: "Closing",
  closed: "Closed",
  withdrawn: "Withdrawn",
  lost: "Lost",
};

/** Middle of the pipeline (between term-sheet acceptance and closing), per program. */
export const POST_TERM_SHEET: Record<DealProgram, string[]> = {
  HUD_232: ["application", "third_party_reports", "hud_review", "firm_commitment"],
  HUD_MULTIFAMILY: ["application", "third_party_reports", "hud_review", "firm_commitment"],
  SBA_7A: ["application", "lender_underwriting", "sba_authorization"],
  SBA_504: ["application", "lender_underwriting", "sba_authorization"],
  HOTEL_CMBS: ["application", "third_party_reports", "underwriting", "commitment"],
  PIP_BRIDGE: ["application", "underwriting", "commitment"],
  AGENCY: ["application", "third_party_reports", "underwriting", "commitment"],
  BANK_LIFE_CO: ["application", "underwriting", "commitment"],
  PRIVATE_BRIDGE: ["underwriting", "commitment"],
  HARD_MONEY: ["underwriting"],
  CONSTRUCTION: ["application", "plan_and_cost_review", "underwriting", "commitment"],
};

/** Stage order of one program's template (terminal stages last). */
export function programStageOrder(program: DealProgram): string[] {
  return ["intake", "engaged", "packaging", "lender_outreach", "term_sheet", ...POST_TERM_SHEET[program], "closing", "closed", "withdrawn", "lost"];
}

/** Terminal stages and the deal status each one implies. */
export const TERMINAL_STAGE_STATUS = { closed: "won", withdrawn: "withdrawn", lost: "lost" } as const;
export type TerminalStage = keyof typeof TERMINAL_STAGE_STATUS;

export function isTerminalStage(stage: string): stage is TerminalStage {
  return Object.prototype.hasOwnProperty.call(TERMINAL_STAGE_STATUS, stage);
}

/** Union of every program template's stages, in lifecycle order. */
export const PIPELINE_STAGES: readonly { key: string; label: string }[] = (() => {
  const used = new Set<string>();
  for (const p of Object.keys(POST_TERM_SHEET) as DealProgram[]) for (const k of programStageOrder(p)) used.add(k);
  return Object.keys(STAGE_LABELS)
    .filter((k) => used.has(k))
    .map((key) => ({ key, label: STAGE_LABELS[key]! }));
})();
