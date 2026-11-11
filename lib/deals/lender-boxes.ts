// The lender's credit-box notes for the loan-type suggestions (lib/deals/lender-directory.ts
// suggestedLoanTypes). Server side only: it reads through the lender-matching runtime.
import { lenderRuntime } from "@/lib/agents/lenders/runtime";

/** The lender's credit-box notes in box id order (the order the SQL backfill uses). [] without a lender runtime. */
export async function boxNotesFor(lenderId: string): Promise<(string | null)[]> {
  const boxes = (await lenderRuntime()?.store.listBoxes({ lenderId })) ?? [];
  return [...boxes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((b) => b.notes);
}
