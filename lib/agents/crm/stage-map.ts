// Deal-desk stage keys (lib/deals/stage-catalog.ts) to Twenty opportunity
// stages. The deal desk is the system of record for the stage; Twenty mirrors
// it so advisors see the same pipeline in both places.
//
// VERIFY: this workspace's opportunity stage enum, confirmed so far only for
// QUALIFICATION, CLOSED_WON and CLOSED_LOST (lib/crm/twenty.ts, lib/notify).
// The other values follow Twenty's sales-pipeline naming. Override any of them
// without a deploy with TWENTY_STAGE_MAP, a JSON object of deal stage -> Twenty
// stage, e.g. {"term_sheet":"TERM_SHEET"}. A stage Twenty rejects fails that
// one write (logged as `failed`) and nothing else.

export const DEFAULT_STAGE_MAP: Readonly<Record<string, string>> = {
  intake: "QUALIFICATION",
  engaged: "QUALIFICATION",
  packaging: "PROPOSAL",
  lender_outreach: "PROPOSAL",
  term_sheet: "NEGOTIATION",
  application: "NEGOTIATION",
  third_party_reports: "NEGOTIATION",
  plan_and_cost_review: "NEGOTIATION",
  hud_review: "NEGOTIATION",
  firm_commitment: "NEGOTIATION",
  lender_underwriting: "NEGOTIATION",
  sba_authorization: "NEGOTIATION",
  underwriting: "NEGOTIATION",
  commitment: "NEGOTIATION",
  closing: "NEGOTIATION",
  closed: "CLOSED_WON",
  withdrawn: "CLOSED_LOST",
  lost: "CLOSED_LOST",
};

/** Twenty stages a deal never leaves on its own. */
export const TERMINAL_TWENTY_STAGES: ReadonlySet<string> = new Set(["CLOSED_WON", "CLOSED_LOST"]);

export const isTerminalTwentyStage = (stage: string): boolean => TERMINAL_TWENTY_STAGES.has(stage);

const STAGE_VALUE = /^[A-Z][A-Z0-9_]{1,40}$/;

/** Reads TWENTY_STAGE_MAP; ignores (and logs) anything that is not a deal stage -> UPPER_SNAKE value. */
export function stageMapFromEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const map: Record<string, string> = { ...DEFAULT_STAGE_MAP };
  const raw = env.TWENTY_STAGE_MAP?.trim();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && STAGE_VALUE.test(v) && /^[a-z0-9_]{1,60}$/.test(k)) map[k] = v;
      else console.warn(`[crm-agent] ignoring TWENTY_STAGE_MAP entry "${k}"`);
    }
  } catch (err) {
    console.warn(`[crm-agent] TWENTY_STAGE_MAP is not valid JSON (${err instanceof Error ? err.message : "error"}); using defaults.`);
  }
  return map;
}

/** Twenty stage for a deal-desk stage, or null when the stage is not mapped. */
export function twentyStageFor(dealStage: string, map: Readonly<Record<string, string>> = DEFAULT_STAGE_MAP): string | null {
  return map[dealStage.trim().toLowerCase()] ?? null;
}
