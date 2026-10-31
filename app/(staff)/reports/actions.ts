"use server";

import { refresh } from "next/cache";
import { staffForMutation } from "@/lib/auth/dal";
import { parseCostInput } from "@/lib/reporting/costs";
import { costWriter, demoCostWriter } from "@/lib/reporting/server";
import { canViewReports } from "./_lib/access";

export type SpendState = { ok?: boolean; message?: string };

/** Records Kubera's marketing spend for one lead source and period (the ROI denominator). */
export async function recordSpendAction(_prev: SpendState, formData: FormData): Promise<SpendState> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, message: auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again." };
  const { principal, services } = auth.ctx;
  if (!canViewReports(principal)) return { ok: false, message: "Only a broker or administrator can record marketing spend." };

  const parsed = parseCostInput({
    source: formData.get("source"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    amount: formData.get("amount"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const writer = services.mode === "fake" ? demoCostWriter() : costWriter();
  if (!writer) return { ok: false, message: "Spend can't be saved because the database isn't configured." };
  const result = await writer.add(parsed.cost, parsed.note, `staff:${principal.email.toLowerCase()}`);
  if (!result.ok) return { ok: false, message: result.error };
  refresh();
  return { ok: true, message: `Recorded the spend for ${parsed.cost.source}.` };
}
