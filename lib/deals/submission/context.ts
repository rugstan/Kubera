// loadSubmissionContext: everything the metrics, readiness, summary and email
// builders read, gathered once per request through the existing stores
// (spec 3.7). Builders never fetch.
//
// It degrades the way the rest of the desk does (Global rule 3): a desk that
// is not configured, or a read that fails, leaves its part empty and logs one
// line, and the page still renders. Some things fail closed instead: an
// unreadable sanctions-hold list becomes a hard stop in `openHolds` (as
// packages.ts assertDealCanGoToLenders does); unreadable principals (the
// email's name check needs them) or an unreadable deal checklist (the
// Underwrite requirements) become hard stops in `unreadable`, so a failed
// read never looks like "nothing to check"; and the deal, profile and sponsor
// reads throw (the editor cannot work without them).
//
// Privacy: principals are narrowed to SubmissionPrincipal (no contact
// details, home address, citizenship, tax id or exhibit contents). Personal
// financial statements are opened only to sum the backers' net worth and
// liquidity; nothing else from a PFS leaves this function. Log lines never
// carry a value read from a personal record.

import type { ChecklistDeps } from "@/lib/checklists/service";
import type { ChecklistProgram, DealChecklistItem } from "@/lib/checklists/types";
import type { ConstructionStore } from "@/lib/construction/store";
import type { ConstructionProject, ConstructionReport, ContractorLicenseCheck } from "@/lib/construction/types";
import type { PropertyAddress } from "@/lib/data/types";
import { openPrincipalSecrets } from "@/lib/principals/crypto-fields";
import { summarizePfs, summarizeReo, type ReoSummary } from "@/lib/principals/financials";
import { buildOrgChart, type OrgChart } from "@/lib/principals/org-chart";
import { PROGRAM_PRINCIPAL_RULES, principalObligations, type PrincipalObligations } from "@/lib/principals/requirements";
import { toPublicPrincipal } from "@/lib/principals/service";
import type { Principal, PrincipalRow, ReoEntry } from "@/lib/principals/types";
import type { PiiKeyring } from "@/lib/privacy/crypto";
import type { LenderProfileId } from "@/lib/spreads/assumptions";
import type { BudgetSpread } from "@/lib/spreads/construction";
import type { StrResult } from "@/lib/spreads/hotel";
import type { GlobalCashFlowResult } from "@/lib/spreads/sba";
import type { NoiResult } from "@/lib/spreads/noi";
import { SPREAD_KINDS, type SpreadKind, type SpreadRecord, type SpreadStore, type SpreadSubject } from "@/lib/spreads/store";
import { packageSpreadsFromSaved, type SavedPackageSpreads } from "@/lib/spreads/workflow";
import { intakeSchema, type Intake } from "@/lib/validation";
import type { DealDeskStore } from "../store";
import type { Deal, DealProgram } from "../types";
import { defaultPlaybook } from "./playbooks";
import type {
  ConstructionBudget,
  GuarantorTotals,
  PropertyFactsRef,
  SubmissionChecklistItem,
  SubmissionContext,
  SubmissionPlaybook,
  SubmissionPrincipal,
  SubmissionProfile,
  SubmissionSpreadFigures,
  SubmissionStore,
  VaultDocumentRef,
} from "./types";

// ---------------------------------------------------------------------------
// Readers (lib/deals/runtime.ts wires them: Supabase in production, the demo desks in fake-auth mode)

/** leads.intake (raw jsonb, parsed here) and leads.created_at for a lead. */
export type LeadIntakeSource = { intake(leadId: string): Promise<{ intake: unknown; createdAt: string } | null> };

export type ConstructionSource = {
  /** The deal's construction project (the most recently updated one when there are several). */
  projectForDeal(dealId: string): Promise<ConstructionProject | null>;
  listReports(projectId: string): Promise<ConstructionReport[]>;
  /** Newest first. */
  listLicenseChecks(projectId: string): Promise<ContractorLicenseCheck[]>;
};

/** Public-record facts cached for an address (else an APN). */
export type PropertyFactsSource = { lookup(address: PropertyAddress | null, apn: string | null): Promise<PropertyFactsRef | null> };

/** DealDeskRuntime.submission. Each reader is null when its desk is not configured. */
export type SubmissionSources = {
  store: SubmissionStore;
  leads: LeadIntakeSource | null;
  spreads: SpreadStore | null;
  construction: ConstructionSource | null;
  propertyFacts: PropertyFactsSource | null;
};

/** What loadSubmissionContext reads; DealDeskRuntime satisfies it. */
export type SubmissionContextDeps = {
  store: Pick<DealDeskStore, "getDeal">;
  checklist: Pick<ChecklistDeps, "checklists" | "principals" | "holds"> | null;
  keyring: PiiKeyring | null;
  now: () => Date;
  vaultDocuments(leadId: string): Promise<VaultDocumentRef[]>;
  submission: SubmissionSources;
};

/** A ConstructionSource over a ConstructionStore that can only list every project (the in-memory store). */
export function constructionSourceFromStore(store: Pick<ConstructionStore, "listProjects" | "listReports" | "listLicenseChecks">): ConstructionSource {
  return {
    async projectForDeal(dealId) {
      const mine = (await store.listProjects()).filter((p) => p.dealId === dealId);
      return mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    },
    listReports: (id) => store.listReports(id),
    listLicenseChecks: (id) => store.listLicenseChecks(id),
  };
}

/** A LeadIntakeSource over fixed records (the demo desks, tests). */
export function staticLeadIntakeSource(records: ReadonlyMap<string, { intake: unknown; createdAt: string }>): LeadIntakeSource {
  return { intake: async (leadId) => (records.has(leadId) ? structuredClone(records.get(leadId)!) : null) };
}

// ---------------------------------------------------------------------------
// Mappings

/** The lender profile whose normalized NOI a playbook is shown with (lib/spreads/jev.ts profileForIntake, keyed by playbook). */
export const PLAYBOOK_LENDER_PROFILE: Readonly<Record<SubmissionPlaybook, LenderProfileId>> = {
  construction: "BANK",
  bridge: "BRIDGE",
  hard_money: "BRIDGE",
  fix_flip: "BRIDGE",
  dscr_rental: "BANK",
  sba_7a: "SBA",
  sba_504: "SBA",
  hud_multifamily: "HUD",
  hud_232: "HUD",
  agency: "AGENCY",
  cmbs: "CMBS",
  hotel_cmbs: "CMBS",
  hotel_pip_bridge: "BRIDGE",
  bank: "BANK",
  life_company: "CMBS",
  mezz_pref: "BRIDGE",
  c_pace: "BANK",
};

/**
 * The checklist program whose principal rules apply when the deal has no
 * checklist yet. BANK_LIFE_CO has no checklist program of its own; the bridge
 * template's carve-out rule is the closest (as the shared fixtures use).
 */
export const DEFAULT_CHECKLIST_PROGRAM: Readonly<Record<DealProgram, ChecklistProgram>> = {
  HUD_232: "HUD_232_223F",
  HUD_MULTIFAMILY: "HUD_MULTIFAMILY_223F",
  SBA_7A: "SBA_7A",
  SBA_504: "SBA_504",
  HOTEL_CMBS: "HOTEL_CMBS",
  PIP_BRIDGE: "PIP_BRIDGE",
  AGENCY: "AGENCY_MULTIFAMILY",
  BANK_LIFE_CO: "BRIDGE",
  PRIVATE_BRIDGE: "BRIDGE",
  HARD_MONEY: "HARD_MONEY",
  CONSTRUCTION: "CONSTRUCTION",
};

const ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const STATE_ZIP = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/;

/** The deal's address as the property-facts cache keys it: "line 1, city, ST 12345" plus the profile's city and ZIP. */
export function propertyAddressOf(deal: Pick<Deal, "propertyAddress" | "propertyState">, profile: Pick<SubmissionProfile, "city" | "postalCode"> | null): PropertyAddress | null {
  const raw = deal.propertyAddress?.trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const line1 = parts[0]!;
  const tail = parts.slice(1);
  const stateFromText = tail.map((t) => STATE_ZIP.exec(t)?.[1]).find(Boolean);
  const city = profile?.city ?? tail.find((t) => !STATE_ZIP.test(t) && !ZIP.test(t));
  const zip = profile?.postalCode ?? ZIP.exec(tail.join(" "))?.[1];
  const state = deal.propertyState ?? stateFromText;
  return { line1, ...(city ? { city } : {}), ...(state ? { state: state.toUpperCase() } : {}), ...(zip ? { zip: zip.slice(0, 5) } : {}) };
}

/** A principal narrowed to what the submission builders may read (types.ts SubmissionPrincipal). Built field by field, never spread. */
export function narrowPrincipal(p: Principal, chart: OrgChart, obligations: ReadonlyMap<string, PrincipalObligations>): SubmissionPrincipal {
  return {
    id: p.id,
    parentId: p.parentId,
    kind: p.kind,
    legalName: p.legalName,
    roles: [...p.roles],
    title: p.title,
    ownershipPct: p.ownershipPct,
    isGuarantor: p.isGuarantor,
    formationState: p.formationState,
    hasPfs: p.hasPfs,
    pfsAsOf: p.pfsAsOf,
    hasForm1919: p.hasForm1919,
    effectivePct: chart.nodes.get(p.id)?.effectivePct ?? 0,
    hasReoSchedule: p.reoSchedule !== null,
    hasHud2530: p.hud2530 !== null,
    hasCreditAuthorization: p.creditAuthorization !== null,
    owes: [...(obligations.get(p.id)?.requirements ?? [])],
  };
}

/**
 * The principals who back the loan: the guarantors, or, when none of the
 * deal's programs has a guaranty (HUD), the key principals (those who owe a
 * PFS). The borrowing entity itself never counts.
 */
export function loanBackers(principals: readonly SubmissionPrincipal[], programs: readonly ChecklistProgram[]): SubmissionPrincipal[] {
  const notBorrower = principals.filter((p) => !p.roles.includes("borrower_entity"));
  const guarantors = notBorrower.filter((p) => p.isGuarantor || p.roles.includes("guarantor") || p.owes.includes("guaranty"));
  if (guarantors.length) return guarantors;
  const anyGuaranty = programs.some((pr) => PROGRAM_PRINCIPAL_RULES[pr].guarantyPct !== null);
  return anyGuaranty ? [] : notBorrower.filter((p) => p.kind === "individual" && p.owes.includes("pfs"));
}

/** Net worth and liquidity in DOLLARS (lib/principals/financials.ts) with the statement date, per backer whose PFS could be opened. */
export type OpenedPfsTotals = { principalId: string; netWorth: number; liquidity: number; asOf: string };

/** Sums the backers' PFS totals (dollars in, cents out). Null when no backer has a PFS on file. */
export function sumGuarantorTotals(backers: readonly SubmissionPrincipal[], pfs: readonly OpenedPfsTotals[]): GuarantorTotals | null {
  const ids = new Set(backers.map((b) => b.id));
  const mine = pfs.filter((p) => ids.has(p.principalId));
  if (!backers.length || !mine.length) return null;
  return {
    netWorthCents: Math.round(mine.reduce((s, p) => s + p.netWorth, 0) * 100),
    liquidityCents: Math.round(mine.reduce((s, p) => s + p.liquidity, 0) * 100),
    pfsCount: mine.length,
    guarantorCount: backers.length,
    oldestPfsAsOf: mine.map((p) => p.asOf).sort()[0] ?? null,
  };
}

const toChecklistItem = (i: DealChecklistItem): SubmissionChecklistItem => ({
  id: i.id,
  itemKey: i.itemKey,
  templateKey: i.templateKey,
  principalId: i.principalId,
  title: i.title,
  category: i.category,
  stage: i.stage,
  required: i.required,
  status: i.status,
  docKind: i.docKind,
  documentDate: i.documentDate,
});

// ---------------------------------------------------------------------------
// Spreads

const NO_FIGURES: SubmissionSpreadFigures = { globalCashFlow: null, constructionBudget: null, hotelStr: null, quotes: null };
const cents = (dollars: number) => Math.round(dollars * 100);
const day = (r: SpreadRecord) => r.createdAt.slice(0, 10);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type LoadedSpreads = { spreads: SavedPackageSpreads | null; figures: SubmissionSpreadFigures; kinds: SpreadKind[] };

/** The latest saved bundle for the deal (else its lead), shown with the playbook's lender profile when one was saved. */
export async function loadSpreads(store: SpreadStore, deal: Pick<Deal, "id" | "leadId">, playbook: SubmissionPlaybook): Promise<LoadedSpreads> {
  const subjects: SpreadSubject[] = [{ dealId: deal.id, leadId: null }, ...(deal.leadId ? [{ dealId: null, leadId: deal.leadId }] : [])];
  let subject: SpreadSubject | null = null;
  let spreads: SavedPackageSpreads | null = null;
  for (const s of subjects) {
    spreads = await packageSpreadsFromSaved(store, s);
    if (spreads) {
      subject = s;
      break;
    }
  }
  if (!spreads || !subject) return { spreads: null, figures: { ...NO_FIGURES }, kinds: [] };

  // The playbook's lender profile, when its operating statement was saved (spec 3.5 NOI precedence).
  const want = PLAYBOOK_LENDER_PROFILE[playbook];
  if (spreads.profile && spreads.profile !== want) {
    const op = await store.latest(subject, "operating_statement", want);
    const noi = (op?.results ?? null) as NoiResult | null;
    if (op && noi) {
      const oldId = spreads.sourceSpreadIds[1];
      spreads = {
        ...spreads,
        noiCents: num(noi.reportedNoi) ? cents(noi.reportedNoi) : null,
        underwrittenNoiCents: num(noi.underwrittenNoi) ? cents(noi.underwrittenNoi) : null,
        revenueCents: num(noi.underwrittenEgi) ? cents(noi.underwrittenEgi) : null,
        expensesCents: num(noi.underwrittenOpex) ? cents(noi.underwrittenOpex) : null,
        profile: want,
        sourceSpreadIds: spreads.sourceSpreadIds.map((id) => (id === oldId ? op.id : id)),
      };
    }
  }

  const summary = await store.latest(subject, "deal_summary");
  const meta = (summary?.results ?? null) as { kinds?: unknown; quoteNoi?: { profile?: LenderProfileId } | null } | null;
  const savedKinds = Array.isArray(meta?.kinds) ? (meta.kinds as unknown[]).filter((k): k is SpreadKind => (SPREAD_KINDS as readonly unknown[]).includes(k)) : [];
  const kinds = SPREAD_KINDS.filter((k) => k === "deal_summary" || savedKinds.includes(k) || (k === "operating_statement" && spreads!.profile !== null));

  const latest = async (kind: SpreadKind, profile: LenderProfileId | null = null) => (kinds.includes(kind) ? store.latest(subject!, kind, profile) : null);
  const [gcf, budget, str, quotes] = await Promise.all([latest("global_cash_flow"), latest("construction_budget"), latest("hotel_str"), latest("quotes", meta?.quoteNoi?.profile ?? null)]);

  const figures: SubmissionSpreadFigures = { ...NO_FIGURES };
  const g = (gcf?.results ?? null) as GlobalCashFlowResult | null;
  if (gcf && g && num(g.globalDscr) && num(g.businessDscr)) figures.globalCashFlow = { spreadId: gcf.id, asOf: day(gcf), globalDscr: g.globalDscr, businessDscr: g.businessDscr };
  const b = (budget?.results ?? null) as BudgetSpread | null;
  if (budget && b?.totals && num(b.totals.total)) {
    const t = b.totals;
    const cat: ConstructionBudget = {
      landCents: cents(t.land),
      hardCents: cents(t.hard),
      softCents: cents(t.soft),
      contingencyCents: cents(t.contingency),
      developerFeeCents: cents(t.developerFee),
      financingCents: cents(t.financing),
      reservesCents: cents(t.reserves),
    };
    figures.constructionBudget = { spreadId: budget.id, asOf: day(budget), budget: cat, totalCents: cents(t.total) };
  }
  const h = (str?.results ?? null) as StrResult | null;
  if (str && h?.ttm && num(h.ttm.occupancy) && num(h.ttm.adr) && num(h.ttm.revpar)) {
    figures.hotelStr = {
      spreadId: str.id,
      asOf: day(str),
      occupancyPct: Math.round(h.ttm.occupancy * 1000) / 10,
      adrCents: cents(h.ttm.adr),
      revparCents: cents(h.ttm.revpar),
      revparIndex: num(h.ttm.rgi) ? h.ttm.rgi : null,
      lastMonth: h.lastMonth,
    };
  }
  // A quote row is usable only when it carries its own rate and amortization
  // (lib/spreads/quotes.ts QuoteAnalysis keeps the constant, not the terms, so
  // rows saved without them are skipped rather than guessed).
  const q = (quotes?.results ?? null) as { quotes?: unknown[] } | null;
  const rows = (q?.quotes ?? []).flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    if (!num(r.loanAmount) || !num(r.ratePct) || !num(r.amortYears) || !num(r.dscr) || !num(r.debtYield)) return [];
    return [{ lender: String(r.lender ?? ""), loanAmountCents: cents(r.loanAmount), ratePct: r.ratePct, amortYears: r.amortYears, dscr: r.dscr, debtYieldPct: Math.round(r.debtYield * 10_000) / 100, ltvPct: num(r.ltv) ? Math.round(r.ltv * 10_000) / 100 : null }];
  });
  if (quotes && rows.length) figures.quotes = { spreadId: quotes.id, asOf: day(quotes), rows };

  return { spreads, figures, kinds };
}

// ---------------------------------------------------------------------------
// The loader

function warn(part: string, err?: unknown, personal = false): void {
  // Personal records (principals, PFS) log the part only, never their error text.
  const detail = personal || err === undefined ? "" : `: ${err instanceof Error ? err.message : String(err)}`;
  console.warn(`[submission] ${part} unavailable${detail}`);
}

async function safe<T>(part: string, fallback: T, fn: () => Promise<T>, personal = false): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    warn(part, err, personal);
    return fallback;
  }
}

/** A read whose failure must stop the send: the fallback keeps the page rendering, and `stop` is recorded as a hard stop. */
async function required<T>(part: string, fallback: T, fn: () => Promise<T>, unreadable: string[], stop: string, personal = false): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    warn(part, err, personal);
    unreadable.push(stop);
    return fallback;
  }
}

export const PRINCIPALS_UNREADABLE = "The deal's principals could not be read, so the email's guarantor-name check cannot run; nothing can go to lenders until they can. Try again.";
export const CHECKLIST_UNREADABLE = "The deal checklist could not be read, so the required documents cannot be checked; nothing can go to lenders until it can. Try again.";

const HOLDS_NOT_CONFIGURED = "Sanctions holds cannot be checked because the checklist and screening desk is not configured; nothing can go to lenders.";
const HOLDS_UNREADABLE = "Sanctions holds could not be checked; nothing can go to lenders until they can. Try again.";

/** The context for one deal, or null when the deal does not exist. */
export async function loadSubmissionContext(rt: SubmissionContextDeps, dealId: string): Promise<SubmissionContext | null> {
  const now = rt.now();
  const deal = await rt.store.getDeal(dealId);
  if (!deal) return null;
  const src = rt.submission;
  const [profile, sponsor] = await Promise.all([src.store.getProfile(dealId), src.store.getSponsor(dealId)]);
  const playbook = profile?.playbook ?? defaultPlaybook(deal.program);
  const desk = rt.checklist;
  const unreadable: string[] = [];

  const [intakeRow, spreads, principalRows, checklists, items, hardMoney, holds, construction, vaultDocuments] = await Promise.all([
    deal.leadId && src.leads ? safe("lead intake", null, () => src.leads!.intake(deal.leadId!)) : Promise.resolve(null),
    src.spreads ? safe("saved spreads", { spreads: null, figures: { ...NO_FIGURES }, kinds: [] as SpreadKind[] }, () => loadSpreads(src.spreads!, deal, playbook)) : Promise.resolve({ spreads: null, figures: { ...NO_FIGURES }, kinds: [] as SpreadKind[] }),
    desk ? required("principals", [] as PrincipalRow[], () => desk.principals.forDeal(dealId), unreadable, PRINCIPALS_UNREADABLE, true) : Promise.resolve([] as PrincipalRow[]),
    desk ? required("checklists", [], () => desk.checklists.checklistsForDeal(dealId), unreadable, CHECKLIST_UNREADABLE) : Promise.resolve([]),
    desk ? required("checklist items", [] as DealChecklistItem[], () => desk.checklists.itemsForDeal(dealId), unreadable, CHECKLIST_UNREADABLE) : Promise.resolve([] as DealChecklistItem[]),
    desk ? safe("hard money file", null, () => desk.checklists.getHmUnderwriting(dealId)) : Promise.resolve(null),
    desk
      ? desk.holds.active(dealId).then(
          (h) => h.map((x) => x.detail),
          (err) => {
            warn("sanctions holds", err);
            return [HOLDS_UNREADABLE];
          },
        )
      : Promise.resolve([HOLDS_NOT_CONFIGURED]),
    src.construction ? safe("construction project", null, () => loadConstruction(src.construction!, dealId)) : Promise.resolve(null),
    deal.leadId ? safe("vault documents", [] as VaultDocumentRef[], () => rt.vaultDocuments(deal.leadId!)) : Promise.resolve([] as VaultDocumentRef[]),
  ]);

  // Lead intake: parsed here (the row is untrusted jsonb); an intake that no longer parses is left out.
  let intake: Intake | null = null;
  if (intakeRow) {
    const parsed = intakeSchema.safeParse(intakeRow.intake);
    if (parsed.success) intake = parsed.data;
    else warn("lead intake (does not parse)");
  }

  // Principals, obligations and the backers' PFS totals.
  const publicPrincipals = principalRows.map(toPublicPrincipal);
  const chart = buildOrgChart(publicPrincipals);
  const programs = checklists.length ? [...new Set(checklists.map((c) => c.program))] : [DEFAULT_CHECKLIST_PROGRAM[deal.program]];
  const obligations = principalObligations(programs, publicPrincipals, chart);
  const principals = publicPrincipals.map((p) => narrowPrincipal(p, chart, obligations));
  const backers = loanBackers(principals, programs);
  const opened: OpenedPfsTotals[] = [];
  for (const b of backers) {
    const row = principalRows.find((r) => r.id === b.id);
    if (!row?.pfsEnc) continue;
    try {
      const { pfs } = openPrincipalSecrets(row, { keyring: rt.keyring, fields: ["pfs"] });
      if (pfs) {
        const s = summarizePfs(pfs, now);
        opened.push({ principalId: b.id, netWorth: s.netWorth, liquidity: s.liquidity, asOf: pfs.asOf });
      }
    } catch {
      warn("a backer's personal financial statement (cannot be opened with the configured key)", undefined, true);
    }
  }
  const guarantorTotals = sumGuarantorTotals(backers, opened);
  const reoEntries: ReoEntry[] = principalRows.filter((r) => r.kind === "individual" && r.reoSchedule && obligations.get(r.id)?.requirements.has("reo_schedule")).flatMap((r) => r.reoSchedule ?? []);
  const reoSummary: ReoSummary | null = reoEntries.length ? summarizeReo(reoEntries, now) : null;

  const propertyFacts = src.propertyFacts ? await safe("property facts", null, () => src.propertyFacts!.lookup(propertyAddressOf(deal, profile), profile?.apn ?? null)) : null;

  return {
    deal,
    profile,
    sponsor,
    intake,
    intakeReceivedAt: intake && intakeRow ? new Date(intakeRow.createdAt).toISOString() : null,
    spreads: spreads.spreads,
    spreadFigures: spreads.figures,
    spreadBundleKinds: spreads.kinds,
    principals,
    guarantorTotals,
    reoSummary,
    hardMoney,
    construction,
    propertyFacts,
    checklistItems: items.map(toChecklistItem),
    vaultDocuments,
    openHolds: holds,
    unreadable: [...new Set(unreadable)],
    now,
  };
}

async function loadConstruction(src: ConstructionSource, dealId: string): Promise<SubmissionContext["construction"]> {
  const project = await src.projectForDeal(dealId);
  if (!project) return null;
  const [reports, checks] = await Promise.all([src.listReports(project.id), src.listLicenseChecks(project.id)]);
  return { project, licenseCheck: checks[0] ?? null, reports };
}

