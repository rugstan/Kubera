// Indicative rates for calculator defaults: the live benchmark plus the
// midpoint of the spread band in lib/sizing/assumptions.ts. These are starting
// points a person can overwrite, never quotes.

import type { Benchmarks } from "@/lib/rates";
import { SPREADS, mid } from "@/lib/sizing/assumptions";

export type IndicativeRates = {
  hud232: number;
  hudMultifamily: number;
  sba504Debenture: number;
  sbaBankFirst: number;
  agency: number;
  hotelCmbs: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function indicativeRates(b: Benchmarks): IndicativeRates {
  return {
    hud232: round2(b.tenYear + mid(SPREADS.hud232)),
    hudMultifamily: round2(b.tenYear + mid(SPREADS.hudMultifamily)),
    sba504Debenture: round2(b.tenYear + mid(SPREADS.sba504Debenture)),
    sbaBankFirst: round2(b.fiveYear + mid(SPREADS.sbaBankFirst)),
    agency: round2(b.tenYear + mid(SPREADS.agency)),
    hotelCmbs: round2(b.tenYear + mid(SPREADS.hotelCmbs)),
  };
}
