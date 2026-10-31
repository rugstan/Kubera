import type { CollateralInput } from "@/lib/compliance/schemas";
import type { Flag } from "@/lib/compliance/gates";

// Mezzanine and equity-pledge flag (WS-Z). The Civ. Code §1916.1 broker
// exemption from the art. XV usury cap depends on the loan being "secured in
// whole or in part by liens on real property" and arranged by a licensed
// broker. A mezzanine loan is normally secured by a pledge of the membership
// or partnership interests in the property-owning entity (a UCC Article 9
// collateral, not a lien on real property), so the exemption is unavailable
// and the loan must stand on its own under the usury cap or another exemption.
//
// This reports the flag; it never states that any loan is or is not usury
// exempt. Counsel gate H owns the final answer. Codes match lib/compliance/gates.ts.

export type CapitalPosition = "senior_mortgage" | "junior_mortgage" | "mezzanine" | "equity_pledge_loan" | "preferred_equity" | "unsecured";

export type EquityPledgeInput = {
  position: CapitalPosition;
  /** A recorded deed of trust or other lien on the real property secures this loan, directly or collaterally. */
  realPropertyLien: boolean;
  /** The collateral is a pledge of ownership interests perfected by UCC filing. */
  pledgeOfEquityInterests?: boolean;
  /** Preferred equity only: fixed or mandatory return, redemption date or put right that makes it behave like debt. */
  hasDebtLikeTerms?: boolean;
};

export type EquityPledgeResult = {
  /** True when the §1916.1 real-property-lien element is missing for this position. */
  usuryExemptionUnavailable: boolean;
  flags: Flag[];
  reasons: string[];
  /** Counsel should review before Kubera represents anything about this position. */
  counselReview: boolean;
  /** Collateral shape for `lib/compliance/gates.ts` (evaluateUsury, mldsRequirement). */
  collateral: CollateralInput;
};

const AUTHORITY = "Civ. Code §1916.1; Cal. Const. art. XV §1";

export function evaluateEquityPledge(input: EquityPledgeInput): EquityPledgeResult {
  const flags: Flag[] = [];
  const reasons: string[] = [];
  const pledged = input.pledgeOfEquityInterests ?? (input.position === "mezzanine" || input.position === "equity_pledge_loan");
  const lien = input.realPropertyLien;
  // Equity-pledge/UCC-only means no real-property lien at all (gates.ts treats the two flags as mutually exclusive).
  const collateral: CollateralInput = { realPropertyLien: lien, equityPledgeOrUccOnly: !lien && pledged };

  let counselReview = false;
  let unavailable = false;

  if (input.position === "preferred_equity" && !input.hasDebtLikeTerms) {
    reasons.push("Preferred equity with no fixed return, redemption date or put right is an equity investment, not a loan; the usury cap generally does not apply to it.");
    reasons.push("Keep it that way in the documents: debt-like terms can lead a court to treat it as a loan.");
    return { usuryExemptionUnavailable: false, flags, reasons, counselReview: false, collateral };
  }

  if (!lien) {
    unavailable = true;
    counselReview = true;
    const what =
      input.position === "mezzanine"
        ? "Mezzanine debt is secured by a pledge of equity interests, not a lien on real property"
        : input.position === "preferred_equity"
          ? "Preferred equity with debt-like terms has no real-property lien and may be treated as a loan"
          : pledged
            ? "The loan is secured only by a pledge of equity interests"
            : "The loan has no lien on real property";
    flags.push({
      code: "usury_exemption_unavailable",
      reason: `${what}, so the §1916.1 broker exemption is unavailable. Do not represent that the loan is exempt; check the rate against the art. XV cap or another exemption.`,
      authority: AUTHORITY,
    });
    flags.push({
      code: "cfl_license_review",
      reason: "A loan not secured by real property is outside a DRE broker license; confirm whether a California Financing Law broker license is needed.",
      authority: "B&P §10131(d); Fin. Code §22057",
    });
    reasons.push(what + ".");
  } else if (input.position === "mezzanine" || input.position === "equity_pledge_loan") {
    // A mezzanine lender that also takes a recorded lien is unusual; the lien must be real and recorded for the element to be met.
    counselReview = true;
    reasons.push("A recorded lien accompanies the equity pledge. Confirm the lien is on the real property (not only a springing or unrecorded one) before treating the real-property element as met.");
  } else {
    reasons.push("A lien on real property secures the loan; the real-property element of §1916.1 is present. Arranging-broker, compensation and lender elements are tracked in the broker-of-record file.");
  }

  if (input.position === "junior_mortgage" && lien) reasons.push("Junior liens are within §1916.1 when secured by real property; lien position is recorded for the file.");

  return { usuryExemptionUnavailable: unavailable, flags, reasons, counselReview, collateral };
}
