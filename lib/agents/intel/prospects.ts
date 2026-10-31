// Refinance-maturity prospecting service (WS-S).
//
//   MaturityProvider (ATTOM) ─► records ─► score ─► prospects table
//
// A scan is idempotent: the dedupe key is the property plus the maturity date,
// so a repeat scan refreshes the machine-owned columns (score, loan facts,
// program) and never touches what staff entered (contact, status, notes,
// assignee). A property that matches the do-not-contact list is stored as
// `do_not_contact` so it is not found again as "new".
//
// Nothing here contacts anyone. Outreach is outreach.ts, behind approvals.

import { createHash } from "node:crypto";
import { PROSPECTING_AGENT, TASKS, logIntelEvent, type IntelEventSink } from "./audit";
import { normalizeText, isSuppressed, maskLabel, suppressionHash, suppressionKeys } from "./suppression";
import { windowDates, type MaturityProvider, type MaturityQuery } from "./maturity";
import type { ProspectFilter, ProspectStore } from "./prospect-store";
import { DEFAULT_MARKET_RATE_PCT, scoreProspect } from "./score";
import type { MaturityRecord, Prospect, ProspectScan, ProspectStatus, ScannedProspect, Suppression, SuppressionKind, SuppressionReason } from "./types";

export class ProspectingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProspectingError";
  }
}

export function dedupeKeyOf(r: Pick<MaturityRecord, "source" | "apn" | "address" | "loan">): string {
  const where = r.apn ? `apn:${r.address.zip ?? ""}:${r.apn.trim().toLowerCase()}` : `addr:${normalizeText(`${r.address.line1} ${r.address.zip ?? ""}`)}`;
  return `p1-${createHash("sha256").update(`${where}|${r.loan.maturityDate}`).digest("hex").slice(0, 40)}`;
}

const cents = (dollars: number | null): number | null => (dollars === null ? null : Math.round(dollars * 100));

/** A provider record to the row a scan writes. Throws on a record that cannot be scored (unreadable maturity date). */
export function toScanned(r: MaturityRecord, scanId: string | null, ctx: { now: Date; marketRatePct: number }): ScannedProspect {
  const s = scoreProspect(r, ctx);
  return {
    dedupeKey: dedupeKeyOf(r),
    source: r.source,
    sourceRef: r.sourceRef,
    scanId,
    addressLine1: r.address.line1,
    city: r.address.city,
    state: r.address.state,
    zip: r.address.zip,
    apn: r.apn,
    propertyType: r.propertyType,
    units: r.units,
    buildingSqft: r.buildingSqft,
    yearBuilt: r.yearBuilt,
    ownerName: r.ownerName,
    ownerKind: r.ownerKind,
    mailing: r.mailing,
    loanOriginalCents: cents(r.loan.originalAmount),
    loanLender: r.loan.lender,
    loanOriginationDate: r.loan.originationDate,
    loanMaturityDate: r.loan.maturityDate,
    loanRatePct: r.loan.ratePct,
    loanType: r.loan.loanType,
    lastSaleDate: r.lastSaleDate,
    lastSalePriceCents: cents(r.lastSalePrice),
    dataAsOf: r.dataAsOf,
    score: s.score,
    scoreFactors: s.factors,
    recommendedProgram: s.program,
    windowBucket: s.windowBucket,
    lastScannedAt: ctx.now.toISOString(),
  };
}

export type ScanDeps = {
  provider: MaturityProvider | null;
  store: ProspectStore;
  events?: IntelEventSink;
  now?: () => Date;
  marketRatePct?: number;
};

export type ScanInput = { query: MaturityQuery; actor: string };

export type ScanResult =
  | { status: "not_configured" }
  | { status: "completed"; scan: ProspectScan; found: number; created: number; updated: number; skipped: number; suppressed: number }
  | { status: "failed"; scan: ProspectScan; error: string };

export const SCAN_LIMITS = { maxZips: 25, maxResults: 1_000, maxWindowMonths: 36 } as const;

export function validateQuery(q: MaturityQuery): MaturityQuery {
  const zips = [...new Set(q.zips.map((z) => z.trim()).filter(Boolean))];
  if (!zips.length) throw new ProspectingError("Enter at least one ZIP code");
  if (zips.length > SCAN_LIMITS.maxZips) throw new ProspectingError(`Scan at most ${SCAN_LIMITS.maxZips} ZIP codes at a time`);
  const bad = zips.find((z) => !/^\d{5}$/.test(z));
  if (bad) throw new ProspectingError(`"${bad}" is not a five-digit ZIP code`);
  if (!Number.isFinite(q.fromMonths) || !Number.isFinite(q.toMonths)) throw new ProspectingError("The maturity window must be numbers of months");
  if (q.fromMonths > q.toMonths) throw new ProspectingError("The window start must be before its end");
  if (q.fromMonths < -SCAN_LIMITS.maxWindowMonths || q.toMonths > SCAN_LIMITS.maxWindowMonths) throw new ProspectingError(`The window is limited to ${SCAN_LIMITS.maxWindowMonths} months either side of today`);
  if (q.minLoanAmount !== undefined && (!Number.isFinite(q.minLoanAmount) || q.minLoanAmount < 0)) throw new ProspectingError("The minimum loan must be a positive amount");
  return { ...q, zips, maxResults: Math.min(q.maxResults ?? 500, SCAN_LIMITS.maxResults) };
}

export function marketRateFromEnv(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.PROSPECT_MARKET_RATE_PCT);
  return env.PROSPECT_MARKET_RATE_PCT && Number.isFinite(v) && v > 0 && v < 25 ? v : DEFAULT_MARKET_RATE_PCT;
}

export async function scanProspects(deps: ScanDeps, input: ScanInput): Promise<ScanResult> {
  if (!deps.provider) return { status: "not_configured" };
  const now = (deps.now ?? (() => new Date()))();
  const query = validateQuery(input.query);
  const marketRatePct = deps.marketRatePct ?? DEFAULT_MARKET_RATE_PCT;

  const outcome = await deps.provider.search(query, now);
  if (outcome.status === "not_configured") return { status: "not_configured" };

  const records = outcome.status === "ok" ? outcome.data : [];
  const scan = await deps.store.startScan({ provider: deps.provider.name, params: { ...query, ...windowDates(query, now) }, startedBy: input.actor }, now);

  if (outcome.status === "error") {
    const done = await deps.store.finishScan(scan.id, { status: "failed", found: 0, createdCount: 0, updatedCount: 0, skippedCount: 0, error: outcome.error }, now);
    await logIntelEvent(deps.events, { eventType: "prospect.scan_failed", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "failed", reasonCodes: ["provider_error"], detail: { scanId: scan.id, provider: deps.provider.name, error: outcome.error } });
    return { status: "failed", scan: done, error: outcome.error };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let suppressed = 0;
  for (const rec of records) {
    let scanned: ScannedProspect;
    try {
      scanned = toScanned(rec, scan.id, { now, marketRatePct });
    } catch {
      skipped++;
      continue;
    }
    const match = await isSuppressed(deps.store, { contactEmail: null, ownerName: scanned.ownerName, addressLine1: scanned.addressLine1, zip: scanned.zip, mailing: scanned.mailing });
    const initial: ProspectStatus = match.suppressed ? "do_not_contact" : "new";
    const r = await deps.store.upsertScanned(scanned, initial, now);
    if (r.created) created++;
    else updated++;
    if (match.suppressed) {
      suppressed++;
      if (r.prospect.status !== "do_not_contact") await deps.store.updateStaff(r.prospect.id, { status: "do_not_contact" }, "system:suppression", now);
    }
  }

  const done = await deps.store.finishScan(scan.id, { status: "completed", found: records.length, createdCount: created, updatedCount: updated, skippedCount: skipped }, now);
  await logIntelEvent(deps.events, {
    eventType: "prospect.scan_completed",
    agent: PROSPECTING_AGENT,
    task: TASKS.outreachDraft,
   
    outcome: "recorded",
    reasonCodes: suppressed ? ["suppression.matched"] : [],
    detail: { scanId: scan.id, provider: deps.provider.name, found: records.length, created, updated, skipped, suppressed },
  });
  return { status: "completed", scan: done, found: records.length, created, updated, skipped, suppressed };
}

// ---------------------------------------------------------------------------
// Staff operations

export async function listProspects(store: ProspectStore, filter?: ProspectFilter): Promise<Prospect[]> {
  return store.listProspects(filter);
}

/** Adds the prospect's own email, owner and address to the do-not-contact list and marks it `do_not_contact`. */
export async function suppressProspect(
  deps: { store: ProspectStore; events?: IntelEventSink; now?: () => Date },
  prospectId: string,
  reason: SuppressionReason,
  actor: string,
): Promise<{ prospect: Prospect; added: Suppression[] }> {
  const now = (deps.now ?? (() => new Date()))();
  const p = await deps.store.getProspect(prospectId);
  if (!p) throw new ProspectingError("Prospect not found");
  const raws: { kind: SuppressionKind; raw: string }[] = [];
  if (p.contactEmail) raws.push({ kind: "email", raw: p.contactEmail });
  if (p.ownerName) raws.push({ kind: "owner", raw: p.ownerName });
  raws.push({ kind: "address", raw: `${p.addressLine1} ${p.zip ?? ""}`.trim() });
  if (p.mailing?.line1) raws.push({ kind: "address", raw: `${p.mailing.line1} ${p.mailing.zip ?? ""}`.trim() });
  const added: Suppression[] = [];
  for (const { kind, raw } of raws) added.push(await deps.store.addSuppression({ kind, valueHash: suppressionHash(kind, raw), label: maskLabel(kind, raw), reason, createdBy: actor }, now));
  const updated = await deps.store.updateStaff(p.id, { status: "do_not_contact" }, actor, now);
  await logIntelEvent(deps.events, { eventType: "prospect.suppressed", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "recorded", reasonCodes: [`suppression.${reason}`], detail: { prospectId: p.id, entries: added.length } });
  return { prospect: updated ?? p, added };
}

/** Adds one value (an email from an unsubscribe reply, a complaint) to the list; matching prospects are marked do_not_contact. */
export async function addSuppressionValue(
  deps: { store: ProspectStore; now?: () => Date },
  input: { kind: SuppressionKind; value: string; reason: SuppressionReason; actor: string },
): Promise<{ suppression: Suppression; prospectsMarked: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const value = input.value.trim();
  if (!value) throw new ProspectingError("Enter the value to suppress");
  if (input.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ProspectingError("That email address does not look right");
  const hash = suppressionHash(input.kind, value);
  const suppression = await deps.store.addSuppression({ kind: input.kind, valueHash: hash, label: maskLabel(input.kind, value), reason: input.reason, createdBy: input.actor }, now);
  let marked = 0;
  for (const p of await deps.store.listProspects({ limit: 1_000 })) {
    if (p.status === "do_not_contact") continue;
    if (suppressionKeys(p).some((k) => k.kind === input.kind && k.hash === hash)) {
      await deps.store.updateStaff(p.id, { status: "do_not_contact" }, input.actor, now);
      marked++;
    }
  }
  return { suppression, prospectsMarked: marked };
}
