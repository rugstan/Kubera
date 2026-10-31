import type { ProgramId } from "@/lib/sizing/types";

export const WHOLESALE_LENDERS = [
  "VIUM_CAPITAL",
  "GREYSTONE",
  "CAMBRIDGE_REALTY_CAPITAL",
  "LUMENT",
  "LIBERTY_SBF",
  "HARVEST_SBF",
  "READY_CAPITAL",
  "TMC_FINANCING_CDC",
  "ROC_CAPITAL",
  "FIDELIS_PRIVATE_FUND",
] as const;

export type WholesaleLender = (typeof WHOLESALE_LENDERS)[number];

// Routing table from program to the lenders Kubera sends that structure to,
// in priority order. Keep it aligned with the signed correspondent and
// fee-protection agreements; lender registrations from /partners land in
// Twenty CRM for the desk to fold in here.
export const LENDER_ROUTING: Record<ProgramId, WholesaleLender[]> = {
  HUD_232_223F: ["CAMBRIDGE_REALTY_CAPITAL", "GREYSTONE", "LUMENT"],
  HUD_232_NEW_CONST: ["CAMBRIDGE_REALTY_CAPITAL", "GREYSTONE", "LUMENT"],
  HUD_221D4_223F_MULTIFAMILY: ["GREYSTONE", "LUMENT"],
  AGENCY_FANNIE_FREDDIE: ["GREYSTONE", "LUMENT"],
  SBA_504_STANDARD: ["TMC_FINANCING_CDC", "VIUM_CAPITAL"],
  SBA_504_PLUS_7A_10M_STACK: ["TMC_FINANCING_CDC", "LIBERTY_SBF", "HARVEST_SBF", "READY_CAPITAL", "VIUM_CAPITAL"],
  HOSPITALITY_CMBS_NON_RECOURSE: ["READY_CAPITAL", "GREYSTONE"],
  HOSPITALITY_PIP_BRIDGE: ["READY_CAPITAL", "FIDELIS_PRIVATE_FUND"],
  BRIDGE_TO_HUD_232: ["LUMENT", "GREYSTONE", "FIDELIS_PRIVATE_FUND"],
  WHITE_LABEL_CRE_BRIDGE: ["FIDELIS_PRIVATE_FUND", "ROC_CAPITAL"],
};
