"use server";

// Server actions for the deal desk. Each one verifies the staff session and
// permission itself, runs one domain operation from lib/deals, and redirects
// back with a short notice or error (no client JavaScript needed).

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ConcurrentUpdateError, GuardError } from "@/lib/deals/store";
import { DealError, advanceDeal, createDeal, editDeal } from "@/lib/deals/service";
import { LockedFieldError } from "@/lib/deals/stages";
import { LedgerError, agencySplit, assertFeeTransition, brokerFee, hardMoneyPoints, partnerSplit, sbaLenderReferralFee, sbaPackagingFee } from "@/lib/deals/ledger";
import { MoneyError, dollarsToCents } from "@/lib/deals/money";
import { InvoiceError, createInvoice, issueInvoice, issueInvoiceMessage, settleInvoice, voidInvoice } from "@/lib/deals/invoices";
import { PackageError, checkOutreachApproval, markOutreachSent, outreachMessage, recordLenderResponse, sendPackageToLender, withdrawOutreach, type SendPackageResult } from "@/lib/deals/packages";
import { ModificationError, applyModificationTerms, lenderNoticeMessage, recordLenderNoticeSent, recordOfficerApproval, retryLenderNotice, submitModification, withdrawModification } from "@/lib/deals/modifications";
import { Form159BlockedError, generateForm159, sendForm159 } from "@/lib/deals/form159";
import { parseLender } from "@/lib/deals/lenders";
import { re853Data, thresholdMonitor, thresholdSnapshot } from "@/lib/deals/dre";
import { brokerIdentity, currentStaff, dealDeskRuntime, deskDeps, form159TemplateId, kuberaAgent, renderPdf, type DealDeskRuntime } from "@/lib/deals/runtime";
import { StaffAccessError, requirePermission, type Permission, type StaffSession } from "@/lib/deals/session";
import { dealPrograms, type DealProgram, type FeeStatus, type NewFeeEntry } from "@/lib/deals/types";
import type { ModificationFacts } from "@/lib/compliance/schemas";

const KNOWN = [StaffAccessError, GuardError, ConcurrentUpdateError, DealError, LockedFieldError, LedgerError, MoneyError, InvoiceError, PackageError, ModificationError, Form159BlockedError];

function messageOf(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (KNOWN.some((K) => err instanceof K)) return (err as Error).message;
  console.error("[deals] action failed", err instanceof Error ? err.message : err);
  return "Something went wrong; nothing further was changed. Try again or check the audit log.";
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value.slice(0, 400))}`;

type Ctx = { staff: StaffSession; rt: DealDeskRuntime };

async function run(path: string, permission: Permission, fn: (ctx: Ctx) => Promise<string>): Promise<never> {
  let target: string;
  try {
    const staff = requirePermission(await currentStaff(), permission);
    const rt = dealDeskRuntime();
    if (!rt) throw new DealError("Deal desk storage is not configured");
    target = withParam(path, "notice", await fn({ staff, rt }));
  } catch (err) {
    target = withParam(path, "error", messageOf(err));
  }
  revalidatePath(path.split("?")[0]!);
  redirect(target);
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const opt = (f: FormData, k: string) => str(f, k) || null;
const bool = (f: FormData, k: string) => f.get(k) === "on";
const num = (f: FormData, k: string) => {
  const s = str(f, k);
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new DealError(`${k} must be a number`);
  return n;
};
const cents = (f: FormData, k: string) => (str(f, k) ? dollarsToCents(str(f, k)) : null);
const ids = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0);
const dealPath = (id: string) => `/deals/${encodeURIComponent(id)}`;

function program(f: FormData): DealProgram {
  const p = str(f, "program");
  if (!(dealPrograms as readonly string[]).includes(p)) throw new DealError("Pick a program");
  return p as DealProgram;
}

// Deals ---------------------------------------------------------------------------

export async function createDealAction(f: FormData): Promise<never> {
  let created: string | null = null;
  try {
    const staff = requirePermission(await currentStaff(), "write");
    const rt = dealDeskRuntime();
    if (!rt) throw new DealError("Deal desk storage is not configured");
    const title = str(f, "title");
    if (title.length < 3) throw new DealError("Give the deal a title");
    const deal = await createDeal(
      { store: rt.store, now: rt.now },
      {
        title,
        program: program(f),
        borrowerName: opt(f, "borrowerName"),
        propertyAddress: opt(f, "propertyAddress"),
        propertyState: opt(f, "propertyState")?.toUpperCase().slice(0, 2) ?? null,
        loanAmountCents: cents(f, "loanAmount"),
        collateralRealProperty: str(f, "collateral") === "" ? null : str(f, "collateral") === "real_property",
        leadId: opt(f, "leadId"),
        ownerId: staff.userId,
      },
      staff.actor,
    );
    created = deal.id;
  } catch (err) {
    redirect(withParam("/deals", "error", messageOf(err)));
  }
  revalidatePath("/deals");
  redirect(withParam(dealPath(created!), "notice", "Deal created at intake."));
}

export async function editDealAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const patch = {
      title: str(f, "title") || undefined,
      borrowerName: opt(f, "borrowerName"),
      propertyAddress: opt(f, "propertyAddress"),
      propertyState: opt(f, "propertyState")?.toUpperCase().slice(0, 2) ?? null,
      engagementAgreementRef: opt(f, "engagementAgreementRef"),
      collateralRealProperty: str(f, "collateral") === "" ? null : str(f, "collateral") === "real_property",
      ...(str(f, "loanAmount") ? { loanAmountCents: dollarsToCents(str(f, "loanAmount")) } : {}),
    };
    await editDeal({ store: rt.store, now: rt.now }, id, Number(str(f, "version")), patch, staff.actor);
    return "Deal updated.";
  });
}

export async function advanceDealAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const event = str(f, "event");
    const terms =
      event === "term_sheet_accepted"
        ? {
            lenderName: opt(f, "lenderName"),
            noteRatePct: num(f, "noteRatePct"),
            termMonths: num(f, "termMonths"),
            amortizationMonths: num(f, "amortizationMonths"),
            interestOnlyMonths: num(f, "interestOnlyMonths"),
            prepayment: opt(f, "prepayment"),
            recourse: opt(f, "recourse"),
            ...(str(f, "brokerCompensation") ? { brokerCompensationCents: dollarsToCents(str(f, "brokerCompensation")) } : {}),
          }
        : undefined;
    const r = await advanceDeal(deskDeps(rt), { dealId: id, event, terms, actor: staff.actor });
    if (!r.ok) throw new DealError(r.reasons.join(" "));
    return `Moved to ${r.to.replace(/_/g, " ")}.`;
  });
}

// Fee ledger ---------------------------------------------------------------------------

export async function addFeeAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const deal = await rt.store.getDeal(id);
    if (!deal) throw new DealError("Deal not found");
    const loan = deal.loanAmountCents ?? 0;
    const key = `${id}:${str(f, "preset")}:${staff.userId}:${rt.now().getTime()}`;
    const pct = num(f, "pct") ?? 0;
    const flat = cents(f, "amount");
    const counterparty = str(f, "counterparty") || "Lender";
    let entries: NewFeeEntry[];
    switch (str(f, "preset")) {
      case "broker_fee":
        entries = [flat !== null ? brokerFee({ dealId: id, loanAmountCents: loan, flatCents: flat, idempotencyKey: key }) : brokerFee({ dealId: id, loanAmountCents: loan, pct, idempotencyKey: key })];
        break;
      case "lender_paid":
        entries = [flat !== null ? brokerFee({ dealId: id, loanAmountCents: loan, flatCents: flat, payer: "lender", idempotencyKey: key }) : brokerFee({ dealId: id, loanAmountCents: loan, pct, payer: "lender", idempotencyKey: key })];
        break;
      case "agency_split":
        entries = [agencySplit({ dealId: id, loanAmountCents: loan, lenderOriginationPct: num(f, "lenderPct") ?? 0, kuberaSharePct: pct, lenderName: counterparty, idempotencyKey: key })];
        break;
      case "hard_money_points":
        entries = hardMoneyPoints({ dealId: id, loanAmountCents: loan, brokerPoints: pct, lenderPoints: num(f, "lenderPct"), kuberaShareOfLenderPointsPct: num(f, "sharePct"), lenderName: counterparty, idempotencyKey: key });
        break;
      case "sba_packaging":
        if (flat === null) throw new DealError("Enter the packaging fee amount");
        entries = [sbaPackagingFee({ dealId: id, flatCents: flat, idempotencyKey: key })];
        break;
      case "sba_referral":
        entries = [sbaLenderReferralFee({ dealId: id, loanAmountCents: loan, pct, lenderName: counterparty, idempotencyKey: key })];
        break;
      case "co_broker_split": {
        const gross = (await rt.store.listFeeEntries(id)).filter((e) => e.payee === "kubera" && e.status !== "void").reduce((a, e) => a + e.amountCents, 0);
        entries = [partnerSplit({ dealId: id, payee: "co_broker", ofCents: gross, pct, partnerName: counterparty, idempotencyKey: key })];
        break;
      }
      default:
        throw new DealError("Pick a fee type");
    }
    for (const e of entries) await rt.store.insertFeeEntry(e, staff.actor, rt.now());
    return `${entries.length} ledger entr${entries.length === 1 ? "y" : "ies"} recorded (projected).`;
  });
}

export async function feeStatusAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const entry = (await rt.store.listFeeEntries(id)).find((e) => e.id === str(f, "entryId"));
    if (!entry) throw new DealError("Ledger entry not found");
    const to = str(f, "to") as FeeStatus;
    assertFeeTransition(entry.status, to);
    if (to === "settled") throw new DealError("Settle compensation through its invoice (closing statement reference)");
    await rt.store.updateFeeEntry(entry.id, { status: to, ...(to === "earned" ? { earnedOn: rt.now().toISOString().slice(0, 10) } : {}), ...(to === "void" ? { voidReason: str(f, "reason") || null } : {}) }, staff.actor, rt.now());
    return `Entry marked ${to}.`;
  });
}

// Invoices ------------------------------------------------------------------------------

export async function createInvoiceAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const inv = await createInvoice(
      { store: rt.store, now: rt.now },
      { dealId: id, feeEntryIds: ids(f, "entryId"), billTo: { kind: str(f, "billToKind") === "lender" ? "lender" : "borrower", name: str(f, "billToName"), email: opt(f, "billToEmail") }, dueOn: opt(f, "dueOn"), actor: staff.actor },
    );
    return `Invoice ${inv.number} drafted.`;
  });
}

export async function invoiceAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const invoiceId = str(f, "invoiceId");
    switch (str(f, "op")) {
      case "issue": {
        return issueInvoiceMessage(await issueInvoice({ store: rt.store, gate: rt.gate, now: rt.now, mailer: rt.mailer }, invoiceId, staff.actor));
      }
      case "settle":
        await settleInvoice({ store: rt.store, now: rt.now }, invoiceId, { settledOn: str(f, "settledOn"), closingStatementRef: str(f, "closingStatementRef") }, staff.actor);
        return "Invoice settled against the closing statement.";
      case "void":
        await voidInvoice({ store: rt.store, now: rt.now }, invoiceId, str(f, "reason"), staff.actor);
        return "Invoice voided; its entries are earned again.";
      default:
        throw new DealError("Unknown invoice action");
    }
  });
}

// Packages and outreach -----------------------------------------------------------------------

export async function sendPackageAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const deal = await rt.store.getDeal(id);
    if (!deal?.leadId) throw new DealError("Link the deal to its lead so vault documents can be packaged");
    const items = await rt.vaultItems(deal.leadId, ids(f, "documentId"));
    const r = await sendPackageToLender(
      { store: rt.store, gate: rt.gate, now: rt.now, baseUrl: rt.baseUrl, mailer: rt.mailer },
      { dealId: id, lenderId: str(f, "lenderId"), items, actor: staff.actor, ttlDays: num(f, "ttlDays"), allowStaleLender: bool(f, "allowStale"), note: opt(f, "note") ?? undefined },
    );
    await rememberShareUrl(id, r);
    return outreachMessage(r);
  });
}

/** The one-time share URL, shown on the next page view; never put in the URL or the logs. */
async function rememberShareUrl(dealId: string, r: SendPackageResult): Promise<void> {
  if (!r.shareUrl) return;
  (await cookies()).set("deal_share_url", r.shareUrl, { httpOnly: true, secure: true, sameSite: "strict", path: dealPath(dealId), maxAge: 120 });
}

export async function outreachAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const outreachId = str(f, "outreachId");
    switch (str(f, "op")) {
      case "check": {
        const r = await checkOutreachApproval({ store: rt.store, gate: rt.gate, now: rt.now, baseUrl: rt.baseUrl, mailer: rt.mailer }, outreachId, staff.actor, { ttlDays: num(f, "ttlDays") });
        await rememberShareUrl(id, r);
        return outreachMessage(r);
      }
      case "sent":
        await markOutreachSent(rt.store, outreachId, staff.actor, rt.now(), opt(f, "messageId") ?? undefined);
        return "Marked sent.";
      case "declined":
        await recordLenderResponse(rt.store, outreachId, { status: "declined", note: opt(f, "note") ?? undefined }, staff.actor, rt.now());
        return "Lender declined recorded.";
      case "term_sheet":
        await recordLenderResponse(rt.store, outreachId, { status: "term_sheet", termSheetRef: str(f, "termSheetRef"), note: opt(f, "note") ?? undefined }, staff.actor, rt.now());
        return "Term sheet recorded.";
      case "withdraw":
        await withdrawOutreach(rt.store, outreachId, str(f, "note") || "Withdrawn by staff", staff.actor, rt.now());
        return "Submission withdrawn and its link revoked.";
      default:
        throw new DealError("Unknown outreach action");
    }
  });
}

export async function revokeLinkAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    await rt.store.revokeShareLink(str(f, "linkId"), staff.actor, str(f, "reason") || "Revoked by staff", rt.now());
    return "Share link revoked.";
  });
}

// Modifications (gate H) ------------------------------------------------------------------------

export async function submitModificationAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const arrangedBy = str(f, "arrangedBy") as ModificationFacts["arrangedBy"];
    const compUsd = num(f, "compensation");
    const facts: ModificationFacts = {
      kind: str(f, "kind") as ModificationFacts["kind"],
      effectiveDate: str(f, "effectiveDate"),
      arrangedBy,
      noteRatePct: num(f, "noteRatePct") ?? 0,
      agreementRecitesBrokerArrangement: bool(f, "recital"),
      ...(arrangedBy === "other_licensed_broker" && str(f, "otherBrokerName") ? { otherBroker: { name: str(f, "otherBrokerName"), dreLicense: str(f, "otherBrokerDre") } } : {}),
      elements: {
        ...(arrangedBy === "kubera" && staff.dreLicense ? { arrangingLicensee: { name: staff.name, dreLicense: staff.dreLicense, activeAtTransaction: bool(f, "licenseActive") } } : {}),
        ...(str(f, "actsFor") ? { actsFor: str(f, "actsFor") as "borrower" | "lender" | "borrower_and_lender" } : {}),
        ...(str(f, "engagementRef") ? { engagementAgreementRef: str(f, "engagementRef") } : {}),
        ...(compUsd ? { compensation: { amountUsd: compUsd, payer: (str(f, "payer") || "borrower") as "borrower" | "lender", expected: true } } : {}),
        negotiationLog: str(f, "termSheetRef") ? [{ at: rt.now().toISOString(), kind: "term_sheet" as const, ref: str(f, "termSheetRef"), summary: str(f, "summary"), byLicensee: staff.name }] : [],
        businessPurposeCertified: bool(f, "businessPurpose"),
      },
    };
    const m = await submitModification(
      { store: rt.store, gate: rt.gate, now: rt.now, mailer: rt.mailer },
      { dealId: id, facts, actor: staff.actor, ...(arrangedBy === "kubera" && compUsd ? { fee: { principalCents: (await rt.store.getDeal(id))?.loanAmountCents ?? 0, flatCents: Math.round(compUsd * 100), payer: (str(f, "payer") || "borrower") as "borrower" | "lender" } } : {}) },
    );
    return `${m.kind[0]!.toUpperCase()}${m.kind.slice(1)} recorded: ${m.status.replace(/_/g, " ")}.`;
  });
}

export async function modificationAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  const op = str(f, "op");
  return run(dealPath(id), op === "officer_approve" ? "officer" : "write", async ({ staff, rt }) => {
    const deps = { store: rt.store, gate: rt.gate, now: rt.now, mailer: rt.mailer };
    const modId = str(f, "modificationId");
    switch (op) {
      case "officer_approve":
        return `Officer approval recorded: ${(await recordOfficerApproval(deps, modId, { name: staff.name, dreLicense: staff.dreLicense ?? "" }, staff.actor)).status.replace(/_/g, " ")}.`;
      case "notice_sent":
        await recordLenderNoticeSent(deps, modId, rt.now(), staff.actor);
        return "Lender notice recorded as sent.";
      case "retry_notice":
        return lenderNoticeMessage(await retryLenderNotice(deps, modId, staff.actor));
      case "apply_terms": {
        const lockedTerms = Object.fromEntries(
          Object.entries({ noteRatePct: num(f, "noteRatePct"), termMonths: num(f, "termMonths") }).filter(([, v]) => v !== undefined),
        );
        await applyModificationTerms(deps, modId, { lockedTerms, ...(str(f, "loanAmount") ? { loanAmountCents: dollarsToCents(str(f, "loanAmount")) } : {}) }, staff.actor);
        return "Modified terms applied to the deal.";
      }
      case "withdraw":
        await withdrawModification(deps, modId, staff.actor);
        return "Change withdrawn.";
      default:
        throw new DealError("Unknown modification action");
    }
  });
}

// SBA Form 159 ------------------------------------------------------------------------------------

export async function generateForm159Action(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const signerName = str(f, "lenderSignerName");
    const applicantSigner = str(f, "applicantSignerName");
    const r = await generateForm159(
      { store: rt.store, render: renderPdf, storage: rt.storage, now: rt.now },
      {
        dealId: id,
        sbaLoanNumber: opt(f, "sbaLoanNumber"),
        lender: { name: str(f, "lenderName"), locationId: opt(f, "lenderLocationId"), signer: signerName ? { name: signerName, email: str(f, "lenderSignerEmail") } : null },
        applicant: { businessName: str(f, "applicantName"), signers: applicantSigner ? [{ name: applicantSigner, email: str(f, "applicantSignerEmail"), title: opt(f, "applicantSignerTitle") ?? undefined }] : [] },
        agent: kuberaAgent(staff),
      },
      staff.actor,
    );
    return r.reused ? `Form 159 v${r.record.version} already matches the ledger.` : `Form 159 v${r.record.version} generated from the ledger.`;
  });
}

export async function sendForm159Action(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  return run(dealPath(id), "write", async ({ staff, rt }) => {
    const r = await sendForm159({ store: rt.store, provider: rt.esign, gate: rt.gate, effects: rt.effects, now: rt.now, templateId: form159TemplateId(rt.esign) }, str(f, "formId"), staff.actor);
    return r.sent ? "Form 159 sent for signature." : "Form 159 is waiting for broker approval; nothing was sent.";
  });
}

// Lender panel -------------------------------------------------------------------------------------

export async function saveLenderAction(f: FormData): Promise<never> {
  return run("/deals/lenders", "write", async ({ staff, rt }) => {
    const input = parseLender({
      name: str(f, "name"),
      category: str(f, "category"),
      categoryEvidenceRef: opt(f, "categoryEvidenceRef"),
      programs: ids(f, "programs"),
      minLoanCents: cents(f, "minLoan"),
      maxLoanCents: cents(f, "maxLoan"),
      states: str(f, "states") ? str(f, "states").split(/[\s,]+/).filter(Boolean) : [],
      assetTypes: str(f, "assetTypes") ? str(f, "assetTypes").split(",").map((s) => s.trim()).filter(Boolean) : [],
      appetiteNotes: opt(f, "appetiteNotes"),
      brokerFriendly: bool(f, "brokerFriendly"),
      feeSplitKind: str(f, "feeSplitKind") || "none",
      feeSplitValue: num(f, "feeSplitValue") ?? 0,
      feeAgreementRef: opt(f, "feeAgreementRef"),
      contactName: opt(f, "contactName"),
      contactEmail: opt(f, "contactEmail"),
      verifiedAt: bool(f, "verifiedNow") ? rt.now().toISOString() : null,
      verifiedBy: bool(f, "verifiedNow") ? staff.actor : null,
    });
    const l = await rt.store.insertLender(input, staff.actor, rt.now());
    return `${l.name} added to the panel.`;
  });
}

export async function lenderAction(f: FormData): Promise<never> {
  return run("/deals/lenders", "write", async ({ staff, rt }) => {
    const id = str(f, "lenderId");
    if (str(f, "op") === "verify") {
      await rt.store.updateLender(id, { verifiedAt: rt.now().toISOString(), verifiedBy: staff.actor }, staff.actor, rt.now());
      return "Verification date updated.";
    }
    const l = await rt.store.getLender(id);
    if (!l) throw new DealError("Lender not found");
    await rt.store.updateLender(id, { active: !l.active }, staff.actor, rt.now());
    return l.active ? `${l.name} deactivated.` : `${l.name} reactivated.`;
  });
}

// DRE reporting ---------------------------------------------------------------------------------------

export async function dreSnapshotAction(f: FormData): Promise<never> {
  return run("/deals/dre", "write", async ({ staff, rt }) => {
    const asOf = rt.now().toISOString().slice(0, 10);
    const yearAgo = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
    const [closed, pipeline, history] = await Promise.all([rt.store.closedLoans({ from: yearAgo, to: asOf }), rt.store.listDeals({ openOnly: true, limit: 1000 }), rt.store.listDreReports()]);
    const counters = thresholdMonitor({ asOf, closed, pipeline, history });
    await rt.store.saveDreReport(thresholdSnapshot(counters, staff.actor), rt.now());
    if (str(f, "op") === "re853_filed") {
      const data = re853Data(counters, brokerIdentity());
      if (!data) throw new DealError("The threshold is not met; there is no RE 853 to record");
      requirePermission(staff, "officer");
      await rt.store.saveDreReport({ ...thresholdSnapshot(counters, staff.actor), reportKind: "RE853", notifiedOn: str(f, "filedOn") || asOf, export: data as unknown as Record<string, unknown> }, rt.now());
      return "RE 853 filing recorded.";
    }
    return counters.thresholdMet ? "Snapshot saved. Threshold met: notify the DRE." : "Snapshot saved.";
  });
}
