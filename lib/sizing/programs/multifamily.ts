// Multifamily / CRE result with the new boxes folded in: tiered Fannie Mae
// and Freddie Mac quotes in place of the single agency quote, DSCR investor
// loans (2–4 and 5+ units), the bridge exit test on the private bridge, and
// HUD 223(a)(7) when the flag is on and an FHA-insured loan is being refinanced.

import type { Benchmarks } from "@/lib/rates";
import { AGENCY, SPREADS, mid } from "../assumptions";
import { sizeMultifamily } from "../programs";
import type { MultifamilyInputs, SizingOptions } from "../types";
import { BANK_PERM, HUD_223A7 } from "./assumptions";
import { sizeAgency } from "./agency";
import { bridgeExitCopy, bridgeExitTest } from "./bridgeExit";
import { sizeDscr2to4, sizeDscr5Plus } from "./dscrInvestor";
import { sizeHud223a7, type Hud223a7Inputs } from "./hud223a7";
import { pickSizerBestFit } from "./quote";
import type { SizerQuote, SizerResult } from "./types";

export type MultifamilyPlusInputs = MultifamilyInputs & {
  occupancyPct?: number;
  agencyTermYears: number;
  agencyIoYears: number;
  /** Stabilized NOI for the bridge exit test; defaults to in-place NOI. */
  stabilizedNoi?: number;
  /** Guarantor credit score for the DSCR investor boxes. */
  fico: number;
  cashOut?: boolean;
  /** 2–4 units: gross monthly rent and monthly taxes, insurance and HOA. */
  monthlyRent?: number;
  monthlyTaxesInsuranceHoa?: number;
  /** Existing FHA-insured loan, for HUD 223(a)(7). */
  existingHud?: Omit<Hud223a7Inputs, "noi" | "value">;
};

export type SizerOptions = SizingOptions & {
  /** Quote HUD 223(a)(7). Defaults to HUD_223A7.enabled. */
  hud223a7?: boolean;
};

/** Reads the public build-time flag; true only when explicitly enabled. */
export function hud223a7FlagFromEnv(value: string | undefined): boolean {
  return value === "true" || HUD_223A7.enabled;
}

export function sizeMultifamilyPlus(i: MultifamilyPlusInputs, rates: Benchmarks, options: SizerOptions = {}): SizerResult {
  const base = sizeMultifamily(i, rates, options);
  const construction = i.transaction === "CONSTRUCTION";
  const residential = i.assetType !== "COMMERCIAL";
  const smallResidential = i.assetType === "MULTIFAMILY" && i.units < 5;
  const quotes: SizerQuote[] = [];

  for (const q of base.quotes) {
    if (q.id === "AGENCY_FANNIE_FREDDIE") {
      const a = {
        residential,
        units: i.units,
        loanAmount: i.loanAmount,
        noi: i.noi,
        value: base.value,
        transaction: i.transaction,
        termYears: i.agencyTermYears,
        ioYears: i.agencyIoYears,
        green: i.green,
        occupancyPct: i.occupancyPct,
      };
      quotes.push(sizeAgency("FANNIE", a, rates), sizeAgency("FREDDIE", a, rates));
      continue;
    }
    if (q.id === "HUD_221D4_223F_MULTIFAMILY" && smallResidential) {
      quotes.push({ ...q, eligible: false, warnings: ["HUD multifamily programs need five or more units.", ...q.warnings] });
      continue;
    }
    if (q.id === "WHITE_LABEL_CRE_BRIDGE" && !construction && q.eligible) {
      const exit = bridgeExitTest({
        payoff: q.loanAmount,
        stabilizedNoi: i.stabilizedNoi ?? i.noi,
        takeoutRatePct: residential ? rates.tenYear + mid(SPREADS.agency) : rates.fiveYear + BANK_PERM.spread,
        takeoutAmortYears: residential ? AGENCY.amortYears : BANK_PERM.amortYears,
      });
      const copy = bridgeExitCopy(exit);
      quotes.push({ ...q, exit, notes: [...q.notes, ...copy.notes], warnings: [...q.warnings, ...copy.warnings] });
      continue;
    }
    quotes.push(q);
  }

  if (residential && !construction) {
    const purpose = i.transaction === "PURCHASE" ? "PURCHASE" : i.cashOut ? "CASH_OUT" : "RATE_TERM";
    const d = { units: i.units, purpose, value: base.value, loanAmount: i.loanAmount, fico: i.fico } as const;
    quotes.push(
      i.units < 5
        ? sizeDscr2to4({ ...d, monthlyRent: i.monthlyRent, monthlyTaxesInsuranceHoa: i.monthlyTaxesInsuranceHoa }, rates)
        : sizeDscr5Plus({ ...d, noi: i.noi }, rates),
    );
  }

  if ((options.hud223a7 ?? HUD_223A7.enabled) && i.existingHud && i.transaction === "REFINANCE" && residential && !smallResidential) {
    quotes.push(sizeHud223a7({ ...i.existingHud, noi: i.noi, value: base.value }, rates));
  }

  return { ...base, quotes, bestFit: pickSizerBestFit(quotes) };
}
