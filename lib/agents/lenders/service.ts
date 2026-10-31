// Lender-matching operations the desk and workflows call: credit-box import
// and review, deal profiles and matching, term-sheet intake into quotes, and
// quote review / comparison. Each function takes its dependencies explicitly
// so tests run on the in-memory stores and fakes.

import { recordLenderResponse } from "@/lib/deals/packages";
import type { DealDeskStore } from "@/lib/deals/store";
import type { Deal, LenderPanelEntry } from "@/lib/deals/types";
import type { ModelGateway } from "@/lib/ai/gateway";
import { AllInError, compareQuotes, computeAllIn, type ComparisonRow } from "./all-in";
import { boxFromRegistration, CreditBoxError, editPatch, parseCreditBoxTerms, reviewPatch } from "./credit-box";
import { matchLenders, type MatchResult } from "./matcher";
import { defaultAssetClass } from "./package";
import type { CreditBoxStore, PartnerSource, QuoteStore, TermSheetMail, TermSheetMailSource } from "./store";
import { LOW_CONFIDENCE, parseTermSheet, termsFromExtraction } from "./term-sheet";
import type { AllInAssumptions, CreditBox, CreditBoxStatus, CreditBoxTerms, DealProfile, Quote, QuoteStatus, QuoteTerms } from "./types";

export class LenderMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LenderMatchError";
  }
}

type Clock = () => Date;

// ---------------------------------------------------------------------------
// Credit boxes

export type ImportSummary = { created: number; updated: number; unchanged: number; skipped: number; errors: string[] };

/**
 * Imports /partners lender registrations as pending-review credit boxes.
 * Idempotent per registration: a re-import refreshes a box still in review
 * and leaves approved, rejected or retired boxes alone (staff own them now).
 */
export async function importLenderRegistrations(deps: { boxes: CreditBoxStore; partners: PartnerSource; desk: DealDeskStore; now: Clock }, actor: string): Promise<ImportSummary> {
  const [rows, lenders] = await Promise.all([deps.partners.listLenderRegistrations({ limit: 500 }), deps.desk.listLenders()]);
  const summary: ImportSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    let terms: CreditBoxTerms;
    try {
      terms = boxFromRegistration(row);
    } catch (err) {
      summary.errors.push(`${row.organization ?? row.email}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const linked = lenders.find((l) => l.partnerId === row.id) ?? null;
    const existing = await deps.boxes.findBoxByPartner(row.id);
    if (!existing) {
      await deps.boxes.insertBox(
        { ...terms, lenderId: linked?.id ?? null, partnerId: row.id, source: "partner_registration", status: "pending_review", verifiedAt: null, verifiedBy: null, reviewedAt: null, reviewedBy: null, reviewNote: null },
        actor,
        deps.now(),
      );
      summary.created += 1;
      continue;
    }
    if (existing.status !== "pending_review") {
      summary.skipped += 1;
      continue;
    }
    const patch = { ...editPatch(existing, terms), ...(linked && !existing.lenderId ? { lenderId: linked.id } : {}) };
    if (!Object.keys(patch).length) {
      summary.unchanged += 1;
      continue;
    }
    await deps.boxes.updateBox(existing.id, existing.recordVersion, patch, actor, deps.now());
    summary.updated += 1;
  }
  return summary;
}

/** Create (staff source, pending review) or edit a credit box. */
export async function saveCreditBox(deps: { boxes: CreditBoxStore; desk: DealDeskStore; now: Clock }, input: { id?: string | null; expectedVersion?: number; lenderId: string | null; terms: unknown }, actor: string): Promise<CreditBox> {
  const terms = parseCreditBoxTerms(input.terms);
  if (input.lenderId) {
    const lender = await deps.desk.getLender(input.lenderId);
    if (!lender) throw new CreditBoxError("Panel lender not found");
  }
  if (!input.id) {
    if (!input.lenderId) throw new CreditBoxError("Pick the panel lender this box belongs to");
    return deps.boxes.insertBox(
      { ...terms, lenderId: input.lenderId, partnerId: null, source: "staff", status: "pending_review", verifiedAt: null, verifiedBy: null, reviewedAt: null, reviewedBy: null, reviewNote: null },
      actor,
      deps.now(),
    );
  }
  const box = await deps.boxes.getBox(input.id);
  if (!box) throw new CreditBoxError("Credit box not found");
  const patch = { ...editPatch(box, terms), ...(input.lenderId !== box.lenderId && input.lenderId ? { lenderId: input.lenderId, ...(box.status === "approved" ? { status: "pending_review" as const } : {}) } : {}) };
  if (!Object.keys(patch).length) return box;
  return deps.boxes.updateBox(box.id, input.expectedVersion ?? box.recordVersion, patch, actor, deps.now());
}

export async function reviewCreditBox(
  deps: { boxes: CreditBoxStore; desk: DealDeskStore; now: Clock },
  input: { id: string; expectedVersion: number; to: CreditBoxStatus; note?: string | null; lenderId?: string | null; verify?: boolean },
  actor: string,
): Promise<CreditBox> {
  const box = await deps.boxes.getBox(input.id);
  if (!box) throw new CreditBoxError("Credit box not found");
  const lenderId = input.lenderId ?? box.lenderId;
  if (input.to === "approved" && lenderId) {
    const lender = await deps.desk.getLender(lenderId);
    if (!lender) throw new CreditBoxError("Panel lender not found");
    if (!lender.active) throw new CreditBoxError(`${lender.name} is inactive on the panel`);
    const missing = box.programs.filter((p) => !lender.programs.includes(p));
    if (missing.length) throw new CreditBoxError(`${lender.name}'s panel record does not list ${missing.join(", ")}; update the panel first`);
  }
  return deps.boxes.updateBox(box.id, input.expectedVersion, reviewPatch(box, { ...input, lenderId, actor }, deps.now()), actor, deps.now());
}

/** Staff re-confirmed the appetite with the lender today. */
export async function verifyCreditBox(deps: { boxes: CreditBoxStore; now: Clock }, id: string, expectedVersion: number, actor: string): Promise<CreditBox> {
  const now = deps.now();
  return deps.boxes.updateBox(id, expectedVersion, { verifiedAt: now.toISOString(), verifiedBy: actor }, actor, now);
}

// ---------------------------------------------------------------------------
// Matching

export type ProfileOverrides = Partial<Omit<DealProfile, "dealId" | "program">>;

export function dealProfile(deal: Pick<Deal, "id" | "program" | "loanAmountCents" | "propertyState">, over: ProfileOverrides = {}): DealProfile {
  return {
    dealId: deal.id,
    program: deal.program,
    loanAmountCents: over.loanAmountCents ?? deal.loanAmountCents,
    propertyState: (over.propertyState ?? deal.propertyState)?.toUpperCase() ?? null,
    assetClass: over.assetClass ?? defaultAssetClass(deal.program),
    ltvPct: over.ltvPct ?? null,
    ltcPct: over.ltcPct ?? null,
    dscr: over.dscr ?? null,
    debtYieldPct: over.debtYieldPct ?? null,
    lienPosition: over.lienPosition ?? "first",
    requiresNonRecourse: over.requiresNonRecourse ?? false,
    targetCloseDays: over.targetCloseDays ?? null,
    franchise: over.franchise ?? null,
  };
}

export async function matchDeal(deps: { boxes: CreditBoxStore; desk: DealDeskStore; now: Clock }, dealId: string, over: ProfileOverrides = {}): Promise<{ deal: Deal; match: MatchResult }> {
  const deal = await deps.desk.getDeal(dealId);
  if (!deal) throw new LenderMatchError(`Deal ${dealId} not found`);
  const [boxes, lenders, outreach] = await Promise.all([deps.boxes.listBoxes({ status: "approved" }), deps.desk.listLenders(), deps.desk.listOutreach(deal.id)]);
  return { deal, match: matchLenders({ profile: dealProfile(deal, over), boxes, lenders, outreach, now: deps.now() }) };
}

// ---------------------------------------------------------------------------
// Term sheets → quotes

export type IntakeDeps = {
  quotes: QuoteStore;
  desk: DealDeskStore;
  mail: TermSheetMailSource;
  gateway: ModelGateway | null;
  now: Clock;
  indexRates?: Record<string, number>;
};

export type IntakeSummary = { parsed: number; needsReview: number; skipped: number; errors: string[]; quotes: Quote[] };

const domainOf = (email: string | null | undefined) => (email ?? "").toLowerCase().split("@")[1]?.trim() ?? "";
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The panel lender a term-sheet email came from: sender domain, then the name the sheet states. */
export function resolveLender(mail: Pick<TermSheetMail, "fromAddress" | "fromName">, statedName: string | null, lenders: readonly LenderPanelEntry[]): LenderPanelEntry | null {
  const domain = domainOf(mail.fromAddress);
  const generic = /^(gmail|yahoo|outlook|hotmail|icloud|aol|proton(mail)?)\./.test(domain);
  if (domain && !generic) {
    const byDomain = lenders.filter((l) => domainOf(l.contactEmail) === domain);
    if (byDomain.length === 1) return byDomain[0]!;
  }
  const name = statedName ? normalize(statedName) : "";
  if (name.length >= 4) {
    const byName = lenders.filter((l) => normalize(l.name) === name || normalize(l.name).includes(name) || name.includes(normalize(l.name)));
    if (byName.length === 1) return byName[0]!;
  }
  return null;
}

export const quoteKeyForMail = (mailId: string) => `mail:${mailId}`;

function priced(terms: QuoteTerms | null, assumptions?: Partial<AllInAssumptions>) {
  if (!terms) return { allIn: null, allInRatePct: null };
  try {
    const allIn = computeAllIn(terms, assumptions);
    return { allIn, allInRatePct: allIn.allInRatePct };
  } catch (err) {
    if (err instanceof AllInError) return { allIn: null, allInRatePct: null };
    throw err;
  }
}

/** Placeholder terms for a quote that could not be priced yet (staff complete them in review). */
function placeholderTerms(lenderName: string, deal: Deal): QuoteTerms {
  return {
    lenderName,
    loanAmountCents: deal.loanAmountCents ?? 0,
    rateType: "fixed",
    ratePct: 0,
    indexName: null,
    spreadBps: null,
    rateFloorPct: null,
    termMonths: 0,
    amortizationMonths: null,
    ioMonths: 0,
    originationFeePct: 0,
    lenderFeesCents: 0,
    thirdPartyCostsCents: 0,
    brokerFeeCents: 0,
    upfrontReservesCents: 0,
    monthlyReservesCents: 0,
    exitFeePct: 0,
    prepay: { kind: "none", schedule: [], months: null },
    mipUpfrontPct: 0,
    mipAnnualPct: 0,
    recourse: null,
    maxLtvPct: null,
    minDscr: null,
    minDebtYieldPct: null,
    bindingConstraint: null,
    timelineDays: null,
    expiresOn: null,
    notes: null,
  };
}

/**
 * Parses routed term-sheet mail into quotes (once per message). Anything with
 * a low-confidence or missing core field goes to the review queue
 * (`needs_review`). When the deal has a sent submission to the same lender,
 * the outreach records the term sheet. Nothing here sends anything.
 */
export async function ingestTermSheets(deps: IntakeDeps, opts: { dealId?: string; limit?: number; actor?: string } = {}): Promise<IntakeSummary> {
  const actor = opts.actor ?? "agent:lenders";
  const summary: IntakeSummary = { parsed: 0, needsReview: 0, skipped: 0, errors: [], quotes: [] };
  const mail = await deps.mail.listTermSheetMail({ ...(opts.dealId ? { dealId: opts.dealId } : {}), limit: opts.limit ?? 25 });
  const lenders = await deps.desk.listLenders();
  for (const m of mail) {
    const key = quoteKeyForMail(m.id);
    if (await deps.quotes.getQuoteByKey(key)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const deal = await deps.desk.getDeal(m.dealId);
      if (!deal) {
        summary.errors.push(`${m.subject}: deal ${m.dealId} not found`);
        continue;
      }
      const parsed = await parseTermSheet({ from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress, subject: m.subject, body: m.bodyText, receivedAt: m.receivedAt }, { gateway: deps.gateway, indexRates: deps.indexRates, traceId: `quote-${m.id}` });
      const lender = resolveLender(m, parsed.extraction.lenderName, lenders);
      const lenderName = lender?.name ?? parsed.extraction.lenderName ?? m.fromName ?? m.fromAddress;
      const built = termsFromExtraction(parsed.extraction, { lenderName, fallbackLoanAmountCents: deal.loanAmountCents });
      const outreach = lender ? (await deps.desk.listOutreach(deal.id)).filter((o) => o.lenderId === lender.id && ["sent", "declined", "term_sheet"].includes(o.status)).at(-1) ?? null : null;
      const lowConfidence = [...built.lowConfidenceFields, ...built.missing.filter((f) => !built.lowConfidenceFields.includes(f))];
      if (!lender) lowConfidence.push("lender");
      const needsReview = lowConfidence.length > 0 || !built.terms;
      const terms = built.terms ?? placeholderTerms(lenderName, deal);
      const { allIn, allInRatePct } = priced(built.terms);
      const quote = await deps.quotes.insertQuote(
        {
          dealId: deal.id,
          lenderId: lender?.id ?? null,
          lenderName,
          outreachId: outreach?.id ?? null,
          mailMessageId: m.id,
          source: "email_parse",
          status: needsReview ? "needs_review" : "active",
          terms,
          confidence: built.confidence,
          lowConfidenceFields: lowConfidence,
          allIn,
          allInRatePct,
          bindingConstraint: terms.bindingConstraint,
          parser: parsed.parser,
          parserModel: parsed.model,
          receivedAt: m.receivedAt,
          expiresOn: terms.expiresOn,
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: parsed.fallbackReason ? `Parsed by rules (${parsed.fallbackReason}).` : null,
          idempotencyKey: key,
        },
        actor,
        deps.now(),
      );
      if (outreach && outreach.status === "sent") await recordLenderResponse(deps.desk, outreach.id, { status: "term_sheet", termSheetRef: key, note: `Term sheet received ${m.receivedAt.slice(0, 10)}` }, actor, deps.now());
      summary.parsed += 1;
      if (needsReview) summary.needsReview += 1;
      summary.quotes.push(quote);
    } catch (err) {
      summary.errors.push(`${m.subject}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}

/** A quote typed in by staff (phone quote, PDF the parser could not read). Active immediately. */
export async function addStaffQuote(deps: { quotes: QuoteStore; desk: DealDeskStore; now: Clock }, input: { dealId: string; lenderId: string | null; terms: QuoteTerms; idempotencyKey: string }, actor: string): Promise<Quote> {
  const deal = await deps.desk.getDeal(input.dealId);
  if (!deal) throw new LenderMatchError(`Deal ${input.dealId} not found`);
  const lender = input.lenderId ? await deps.desk.getLender(input.lenderId) : null;
  if (input.lenderId && !lender) throw new LenderMatchError("Panel lender not found");
  const lenderName = lender?.name ?? input.terms.lenderName;
  if (!lenderName.trim()) throw new LenderMatchError("Name the lender");
  const terms = { ...input.terms, lenderName };
  const allIn = computeAllIn(terms); // throws AllInError on invalid terms
  const outreach = lender ? (await deps.desk.listOutreach(deal.id)).filter((o) => o.lenderId === lender.id).at(-1) ?? null : null;
  const now = deps.now();
  return deps.quotes.insertQuote(
    {
      dealId: deal.id,
      lenderId: lender?.id ?? null,
      lenderName,
      outreachId: outreach?.id ?? null,
      mailMessageId: null,
      source: "staff",
      status: "active",
      terms,
      confidence: {},
      lowConfidenceFields: [],
      allIn,
      allInRatePct: allIn.allInRatePct,
      bindingConstraint: terms.bindingConstraint,
      parser: "staff",
      parserModel: null,
      receivedAt: now.toISOString(),
      expiresOn: terms.expiresOn,
      reviewedAt: now.toISOString(),
      reviewedBy: actor,
      reviewNote: null,
      idempotencyKey: input.idempotencyKey,
    },
    actor,
    now,
  );
}

/** Staff confirm (and correct) a parsed quote: it leaves the review queue with recomputed all-in cost. */
export async function reviewQuote(deps: { quotes: QuoteStore; desk: DealDeskStore; now: Clock }, input: { quoteId: string; terms: QuoteTerms; lenderId?: string | null; note?: string | null }, actor: string): Promise<Quote> {
  const q = await deps.quotes.getQuote(input.quoteId);
  if (!q) throw new LenderMatchError("Quote not found");
  if (!["needs_review", "active"].includes(q.status)) throw new LenderMatchError(`A ${q.status} quote cannot be reviewed`);
  const lender = input.lenderId ? await deps.desk.getLender(input.lenderId) : null;
  if (input.lenderId && !lender) throw new LenderMatchError("Panel lender not found");
  const lenderName = lender?.name ?? (input.terms.lenderName.trim() || q.lenderName);
  const terms = { ...input.terms, lenderName };
  const allIn = computeAllIn(terms);
  const now = deps.now();
  return deps.quotes.updateQuote(
    q.id,
    {
      terms,
      lenderId: lender?.id ?? q.lenderId,
      lenderName,
      allIn,
      allInRatePct: allIn.allInRatePct,
      bindingConstraint: terms.bindingConstraint,
      expiresOn: terms.expiresOn,
      status: "active",
      reviewedAt: now.toISOString(),
      reviewedBy: actor,
      reviewNote: input.note?.trim() || null,
    },
    actor,
    now,
  );
}

const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  needs_review: ["declined", "withdrawn", "expired"],
  active: ["accepted", "declined", "withdrawn", "expired"],
  accepted: ["withdrawn"],
  declined: ["active"],
  withdrawn: [],
  expired: ["active"],
};

/** Record the borrower's or lender's decision on a quote (record keeping; nothing is sent). */
export async function setQuoteStatus(deps: { quotes: QuoteStore; now: Clock }, quoteId: string, to: QuoteStatus, actor: string, note?: string | null): Promise<Quote> {
  const q = await deps.quotes.getQuote(quoteId);
  if (!q) throw new LenderMatchError("Quote not found");
  if (!QUOTE_TRANSITIONS[q.status].includes(to)) throw new LenderMatchError(`A ${q.status.replace("_", " ")} quote cannot become ${to.replace("_", " ")}`);
  const unreviewed = q.source !== "staff" && q.lowConfidenceFields.length > 0 && !q.reviewedAt;
  if ((to === "active" || to === "accepted") && (!q.allIn || unreviewed)) throw new LenderMatchError("Review the quote's terms first");
  return deps.quotes.updateQuote(q.id, { status: to, ...(note?.trim() ? { reviewNote: note.trim().slice(0, 500) } : {}) }, actor, deps.now());
}

/** Comparison of a deal's live quotes under one set of assumptions. */
export async function compareDealQuotes(deps: { quotes: QuoteStore; now: Clock }, dealId: string, assumptions: Partial<AllInAssumptions> = {}, opts: { targetCloseDays?: number | null; includeReview?: boolean } = {}): Promise<{ rows: ComparisonRow[]; quotes: Quote[] }> {
  const quotes = await deps.quotes.listQuotes(dealId);
  const live = quotes.filter((q) => (q.status === "active" || q.status === "accepted" || (opts.includeReview && q.status === "needs_review" && q.allIn)) && q.terms.termMonths > 0);
  const rows = compareQuotes(
    live.map((q) => ({ id: q.id, lenderName: q.lenderName, status: q.status, terms: q.terms })),
    assumptions,
    { today: deps.now().toISOString().slice(0, 10), targetCloseDays: opts.targetCloseDays ?? null },
  );
  return { rows, quotes };
}

export { LOW_CONFIDENCE };
