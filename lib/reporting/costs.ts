import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { dollarsToCents, MoneyError } from "@/lib/deals/money";
import type { SourceCost } from "./types";

// Recording Corin's own marketing spend per lead source (lead_source_costs),
// the denominator of lead-source ROI. It is a cost record only: nothing here
// pays anyone or moves money.

export const costInputSchema = z
  .object({
    source: z
      .string()
      .trim()
      .min(1, "Name the lead source")
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_. -]*$/, "Use letters, numbers, spaces, dots, dashes and underscores"),
    periodStart: z.iso.date("Enter the first day of the period"),
    periodEnd: z.iso.date("Enter the last day of the period"),
    amount: z.string().trim().min(1, "Enter the amount spent"),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.periodStart <= v.periodEnd, { path: ["periodEnd"], message: "The period must end on or after its first day" });

export type CostInput = z.infer<typeof costInputSchema>;

export type CostResult = { ok: true; cost: SourceCost } | { ok: false; error: string };

/** Validates form input and converts the dollar amount to cents. */
export function parseCostInput(raw: unknown): { ok: true; cost: SourceCost; note: string | null } | { ok: false; error: string } {
  const parsed = costInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  let spendCents: number;
  try {
    spendCents = dollarsToCents(parsed.data.amount);
  } catch (err) {
    return { ok: false, error: err instanceof MoneyError ? "Enter the amount as dollars, like 2500 or 2,500.50" : "Enter a valid amount" };
  }
  if (spendCents > 1_000_000_000_00) return { ok: false, error: "That amount is too large" };
  return { ok: true, cost: { source: parsed.data.source.toLowerCase().replace(/\s+/g, "_"), periodStart: parsed.data.periodStart, periodEnd: parsed.data.periodEnd, spendCents }, note: parsed.data.note || null };
}

export interface SourceCostWriter {
  add(cost: SourceCost, note: string | null, by: string): Promise<CostResult>;
}

export class SupabaseCostWriter implements SourceCostWriter {
  constructor(private readonly db: SupabaseClient) {}
  async add(cost: SourceCost, note: string | null, by: string): Promise<CostResult> {
    const { error } = await this.db
      .from("lead_source_costs")
      .insert({ created_by: by.slice(0, 200), source: cost.source, period_start: cost.periodStart, period_end: cost.periodEnd, spend_cents: cost.spendCents, note });
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "Spend for that source and period is already recorded" };
      console.error("[reports] recording spend failed:", error.message);
      return { ok: false, error: "Could not save the spend. Try again." };
    }
    return { ok: true, cost };
  }
}

/** In-memory writer (tests and fake-auth demo mode). */
export class MemoryCostWriter implements SourceCostWriter {
  readonly costs: SourceCost[] = [];
  async add(cost: SourceCost, _note: string | null, _by: string): Promise<CostResult> {
    if (this.costs.some((c) => c.source === cost.source && c.periodStart === cost.periodStart && c.periodEnd === cost.periodEnd)) {
      return { ok: false, error: "Spend for that source and period is already recorded" };
    }
    this.costs.push({ ...cost });
    return { ok: true, cost };
  }
}
