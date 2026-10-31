// Fee ledger: Kubera's broker compensation per deal, as it will appear on the
// lender's closing statement. Record keeping only — Kubera never receives loan
// proceeds or holds anyone's funds; compensation is paid through the closing
// (escrow / title) by the party named as payer.
//
// Calculators build entries for the common structures: agency origination
// splits, hard money broker points, broker-arranged extension / modification
// fees, SBA packaging and referral compensation (Form 159 inputs).

import { z } from "zod";
import { percentOf, sumCents } from "./money";
import type { FeeEntry, FeeEntryKind, FeePayee, FeePayer, FeeStatus, NewFeeEntry, Sba159Category } from "./types";

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const newFeeEntrySchema = z
  .object({
    dealId: z.string().min(1),
    entryKind: z.enum([
      "broker_fee",
      "lender_paid_compensation",
      "agency_split",
      "hard_money_points",
      "extension_fee",
      "modification_fee",
      "sba_packaging_fee",
      "referral_fee",
      "co_broker_split",
    ]),
    payer: z.enum(["borrower", "lender", "kubera"]),
    payee: z.enum(["kubera", "co_broker", "referral_partner"]),
    basis: z.enum(["flat", "percent_of_loan", "points", "percent_of_lender_fee"]),
    ratePct: z.number().finite().min(0).max(100).nullable(),
    baseCents: cents.nullable(),
    amountCents: cents,
    description: z.string().trim().min(1).max(300),
    idempotencyKey: z.string().trim().min(8).max(200),
    status: z.enum(["projected", "earned"]).optional(),
    earnedOn: z.iso.date().nullable().optional(),
    counterparty: z.string().trim().max(160).nullable().optional(),
    modificationId: z.string().nullable().optional(),
    sba159Category: z.enum(["packaging", "other_services", "referral"]).nullable().optional(),
  })
  .superRefine((e, ctx) => {
    const kuberaReceives = e.payee === "kubera";
    if (kuberaReceives === (e.payer === "kubera")) {
      ctx.addIssue({ code: "custom", path: ["payer"], message: "Either Kubera receives compensation (from the borrower or lender) or Kubera owes a co-broker / referral partner its share" });
    }
    if (!kuberaReceives && e.entryKind !== "co_broker_split" && e.entryKind !== "referral_fee") {
      ctx.addIssue({ code: "custom", path: ["entryKind"], message: "Only co-broker splits and referral fees are owed by Kubera" });
    }
    if (e.basis !== "flat") {
      if (e.ratePct === null || e.baseCents === null) ctx.addIssue({ code: "custom", path: ["ratePct"], message: "Percent-based entries need a rate and a base" });
      else if (percentOf(e.baseCents, e.ratePct) !== e.amountCents) ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Amount does not equal rate × base" });
    }
  });

/** Validates a new entry (calculators below produce valid ones). */
export function validateFeeEntry(entry: NewFeeEntry): NewFeeEntry {
  const r = newFeeEntrySchema.safeParse(entry);
  if (!r.success) throw new LedgerError(r.error.issues.map((i) => i.message).join("; "));
  return entry;
}

// ---------------------------------------------------------------------------
// Calculators

type Base = { dealId: string; idempotencyKey?: string };

function entry(b: Base, e: Omit<NewFeeEntry, "dealId" | "idempotencyKey">, key: string): NewFeeEntry {
  return validateFeeEntry({ dealId: b.dealId, idempotencyKey: b.idempotencyKey ?? `${b.dealId}:${key}`, ...e });
}

/** Borrower-paid broker fee as a percent of the loan (e.g. 1.0 = 1%) or flat. */
export function brokerFee(b: Base & { loanAmountCents: number; pct?: number; flatCents?: number; payer?: "borrower" | "lender" }): NewFeeEntry {
  const payer = b.payer ?? "borrower";
  const kind: FeeEntryKind = payer === "lender" ? "lender_paid_compensation" : "broker_fee";
  if (b.flatCents !== undefined) {
    return entry(b, { entryKind: kind, payer, payee: "kubera", basis: "flat", ratePct: null, baseCents: null, amountCents: b.flatCents, description: payer === "lender" ? "Lender-paid broker compensation" : "Broker fee" }, `${kind}:flat`);
  }
  const pct = b.pct ?? 0;
  return entry(
    b,
    { entryKind: kind, payer, payee: "kubera", basis: "percent_of_loan", ratePct: pct, baseCents: b.loanAmountCents, amountCents: percentOf(b.loanAmountCents, pct), description: `${payer === "lender" ? "Lender-paid broker compensation" : "Broker fee"} ${pct}% of loan` },
    `${kind}:pct`,
  );
}

/**
 * Agency (Fannie Mae DUS / Freddie Mac Optigo) loans: the seller/servicer earns
 * an origination fee and pays Kubera an agreed share of it (lender-paid).
 */
export function agencySplit(b: Base & { loanAmountCents: number; lenderOriginationPct: number; kuberaSharePct: number; lenderName: string }): NewFeeEntry {
  const lenderFee = percentOf(b.loanAmountCents, b.lenderOriginationPct);
  return entry(
    b,
    {
      entryKind: "agency_split",
      payer: "lender",
      payee: "kubera",
      basis: "percent_of_lender_fee",
      ratePct: b.kuberaSharePct,
      baseCents: lenderFee,
      amountCents: percentOf(lenderFee, b.kuberaSharePct),
      description: `${b.kuberaSharePct}% of ${b.lenderName}'s ${b.lenderOriginationPct}% origination fee`,
      counterparty: b.lenderName,
    },
    "agency_split",
  );
}

/**
 * Hard money: Kubera's broker points (borrower-paid, on the closing statement)
 * and, when the lender shares its own points, the lender-paid share.
 */
export function hardMoneyPoints(b: Base & { loanAmountCents: number; brokerPoints: number; lenderPoints?: number; kuberaShareOfLenderPointsPct?: number; lenderName?: string }): NewFeeEntry[] {
  const out: NewFeeEntry[] = [];
  if (b.brokerPoints > 0) {
    out.push(
      entry(
        b,
        { entryKind: "hard_money_points", payer: "borrower", payee: "kubera", basis: "points", ratePct: b.brokerPoints, baseCents: b.loanAmountCents, amountCents: percentOf(b.loanAmountCents, b.brokerPoints), description: `${b.brokerPoints} broker point(s)` },
        "hard_money_points:broker",
      ),
    );
  }
  if (b.lenderPoints && b.kuberaShareOfLenderPointsPct) {
    const lenderPointsCents = percentOf(b.loanAmountCents, b.lenderPoints);
    out.push(
      entry(
        { dealId: b.dealId, idempotencyKey: b.idempotencyKey ? `${b.idempotencyKey}:lender` : undefined },
        {
          entryKind: "lender_paid_compensation",
          payer: "lender",
          payee: "kubera",
          basis: "percent_of_lender_fee",
          ratePct: b.kuberaShareOfLenderPointsPct,
          baseCents: lenderPointsCents,
          amountCents: percentOf(lenderPointsCents, b.kuberaShareOfLenderPointsPct),
          description: `${b.kuberaShareOfLenderPointsPct}% of the lender's ${b.lenderPoints} point(s)`,
          counterparty: b.lenderName ?? null,
        },
        "hard_money_points:lender_share",
      ),
    );
  }
  return out;
}

/**
 * Broker-arranged extension or modification fee. Under SB 1146 each change must
 * itself be arranged by a licensed broker; Kubera's compensation for arranging
 * it is either a percent of the outstanding principal or a flat fee.
 */
export function changeFee(
  b: Base & { kind: "extension" | "modification" | "forbearance"; modificationId: string; principalCents: number; pct?: number; flatCents?: number; payer: "borrower" | "lender" },
): NewFeeEntry {
  const entryKind: FeeEntryKind = b.kind === "extension" ? "extension_fee" : "modification_fee";
  const label = `${b.kind[0]!.toUpperCase()}${b.kind.slice(1)} arranged by Kubera`;
  const key = `${entryKind}:${b.modificationId}`;
  if (b.flatCents !== undefined) {
    return entry(b, { entryKind, payer: b.payer, payee: "kubera", basis: "flat", ratePct: null, baseCents: null, amountCents: b.flatCents, description: label, modificationId: b.modificationId }, key);
  }
  const pct = b.pct ?? 0;
  return entry(
    b,
    { entryKind, payer: b.payer, payee: "kubera", basis: "percent_of_loan", ratePct: pct, baseCents: b.principalCents, amountCents: percentOf(b.principalCents, pct), description: `${label}: ${pct}% of outstanding principal`, modificationId: b.modificationId },
    key,
  );
}

/** SBA application packaging (applicant-paid) — Form 159 "packaging" line. */
export function sbaPackagingFee(b: Base & { flatCents: number; description?: string }): NewFeeEntry {
  return entry(b, { entryKind: "sba_packaging_fee", payer: "borrower", payee: "kubera", basis: "flat", ratePct: null, baseCents: null, amountCents: b.flatCents, description: b.description ?? "SBA loan application packaging", sba159Category: "packaging" }, "sba_packaging_fee");
}

/** Lender-paid referral compensation — Form 159 "referral" line. */
export function sbaLenderReferralFee(b: Base & { loanAmountCents: number; pct: number; lenderName: string }): NewFeeEntry {
  return entry(
    b,
    { entryKind: "referral_fee", payer: "lender", payee: "kubera", basis: "percent_of_loan", ratePct: b.pct, baseCents: b.loanAmountCents, amountCents: percentOf(b.loanAmountCents, b.pct), description: `Referral fee paid by ${b.lenderName}`, counterparty: b.lenderName, sba159Category: "referral" },
    "referral_fee:lender",
  );
}

/** Kubera's share owed to a co-broker or referral partner (ledger record only). */
export function partnerSplit(b: Base & { payee: Exclude<FeePayee, "kubera">; ofCents: number; pct: number; partnerName: string }): NewFeeEntry {
  return entry(
    b,
    {
      entryKind: b.payee === "co_broker" ? "co_broker_split" : "referral_fee",
      payer: "kubera",
      payee: b.payee,
      basis: "percent_of_lender_fee",
      ratePct: b.pct,
      baseCents: b.ofCents,
      amountCents: percentOf(b.ofCents, b.pct),
      description: `${b.pct}% split owed to ${b.partnerName}`,
      counterparty: b.partnerName,
    },
    `${b.payee}:${b.partnerName.toLowerCase().replace(/\W+/g, "-")}`,
  );
}

// ---------------------------------------------------------------------------
// Status transitions

const TRANSITIONS: Record<FeeStatus, FeeStatus[]> = {
  projected: ["earned", "void"],
  earned: ["invoiced", "settled", "void"],
  invoiced: ["settled", "earned"],
  settled: [],
  void: [],
};

export function canTransitionFee(from: FeeStatus, to: FeeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertFeeTransition(from: FeeStatus, to: FeeStatus): void {
  if (!canTransitionFee(from, to)) throw new LedgerError(`A ${from} ledger entry cannot become ${to}`);
}

// ---------------------------------------------------------------------------
// Summary

export type LedgerSummary = {
  /** Kubera's gross compensation (excludes void). */
  grossCents: number;
  /** Shares Kubera owes co-brokers / referral partners (excludes void). */
  owedToPartnersCents: number;
  netCents: number;
  byStatus: Record<FeeStatus, number>;
  byPayer: Record<Exclude<FeePayer, "kubera">, number>;
  bySba159: Record<Sba159Category, number>;
};

export function summarizeLedger(entries: FeeEntry[]): LedgerSummary {
  const live = entries.filter((e) => e.status !== "void");
  const incoming = live.filter((e) => e.payee === "kubera");
  const outgoing = live.filter((e) => e.payee !== "kubera");
  const byStatus = { projected: 0, earned: 0, invoiced: 0, settled: 0, void: 0 } as Record<FeeStatus, number>;
  for (const e of entries) if (e.payee === "kubera") byStatus[e.status] += e.amountCents;
  const grossCents = sumCents(incoming.map((e) => e.amountCents));
  const owedToPartnersCents = sumCents(outgoing.map((e) => e.amountCents));
  const byPayer = {
    borrower: sumCents(incoming.filter((e) => e.payer === "borrower").map((e) => e.amountCents)),
    lender: sumCents(incoming.filter((e) => e.payer === "lender").map((e) => e.amountCents)),
  };
  const bySba159 = { packaging: 0, other_services: 0, referral: 0 } as Record<Sba159Category, number>;
  for (const e of incoming) bySba159[sba159CategoryOf(e)] += e.amountCents;
  return { grossCents, owedToPartnersCents, netCents: grossCents - owedToPartnersCents, byStatus, byPayer, bySba159 };
}

/** Form 159 bucket for a Kubera-received entry. */
export function sba159CategoryOf(e: Pick<FeeEntry, "sba159Category" | "payer" | "entryKind">): Sba159Category {
  if (e.sba159Category) return e.sba159Category;
  if (e.entryKind === "sba_packaging_fee") return "packaging";
  if (e.payer === "lender") return "referral";
  return "other_services";
}
