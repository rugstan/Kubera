// Demo extraction review queue for fake-auth mode (local development and e2e):
// two extractions waiting for a reviewer, built through the same validation
// and assessment the pipeline uses so their status and flags are real. The
// deal ids match the demo pipeline (lib/approvals/demo.ts).

import { DEMO_DEAL_IDS } from "@/lib/approvals/demo";
import type { MemoryExtractionStore, NewExtraction } from "./store";
import type { DocType, ExtractedField, ExtractionResult } from "./types";
import { assessExtraction, validateExtraction } from "./validate";

const field = (value: number | string, confidence: number, evidence: string): ExtractedField => ({ value, confidence, source: "rules", evidence });

function demoRow(docType: DocType, scalars: Record<string, ExtractedField>, extra: Partial<NewExtraction>): NewExtraction {
  const result: ExtractionResult = validateExtraction({ docType, scalars, rows: [], warnings: [] });
  const a = assessExtraction(result);
  return {
    source_type: "manual",
    document_id: null,
    mail_message_id: null,
    attachment_name: null,
    lead_id: null,
    deal_id: null,
    doc_type: docType,
    source_format: "xlsx",
    source_sha256: null,
    status: a.status,
    engine: "rules",
    model: null,
    prompt_version: null,
    fields: { scalars: result.scalars, rows: result.rows },
    row_count: result.rows.length,
    overall_confidence: a.overallConfidence,
    low_confidence_fields: a.lowConfidenceFields,
    warnings: result.warnings,
    error: null,
    ...extra,
  };
}

export async function seedDemoExtractions(store: MemoryExtractionStore): Promise<void> {
  // Guarantor PFS whose stated total assets disagree with the line items (a typo on the statement).
  await store.insert(
    demoRow(
      "PFS",
      {
        asOfDate: field("2026-09-30", 0.95, "row 2: Statement date 09/30/2026"),
        cashOnHand: field(200_000, 0.92, "row 5: Cash on hand & in banks"),
        marketableSecurities: field(300_000, 0.9, "row 6: Stocks and bonds"),
        retirementAccounts: field(400_000, 0.62, "row 7: IRA / 401k (handwritten)"),
        realEstateValue: field(1_000_000, 0.9, "row 8: Real estate owned"),
        totalAssets: field(1_950_000, 0.9, "row 12: Total assets"),
        realEstateDebt: field(300_000, 0.9, "row 15: Mortgages on real estate"),
        notesPayable: field(100_000, 0.88, "row 16: Notes payable to banks"),
        totalLiabilities: field(400_000, 0.9, "row 20: Total liabilities"),
        netWorth: field(1_500_000, 0.9, "row 22: Net worth"),
      },
      { deal_id: DEMO_DEAL_IDS.seniorLiving, attachment_name: "Sunrise guarantor PFS.xlsx" },
    ),
  );
  // A T-12 read with low confidence on its headline figures.
  await store.insert(
    demoRow(
      "T12",
      {
        propertyName: field("Harbor Inn", 0.7, "header: Harbor Inn P&L"),
        periodEnd: field("2026-08-31", 0.6, "header: Twelve months ending Aug 2026"),
        months: field(12, 0.6, "header: 12 months"),
        roomsRevenue: field(3_250_000, 0.55, "row 4: Rooms"),
      },
      { deal_id: DEMO_DEAL_IDS.hotel, attachment_name: "Harbor Inn T-12.xlsx", source_format: "pdf" },
    ),
  );
}
