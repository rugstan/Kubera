"use server";

// Server actions for the lenders desk. Each verifies the staff session and
// permission itself (a layout guard does not protect server actions), runs
// one operation from lib/agents/lenders, and redirects back with a notice or
// error. Outbound submissions go through the broker approval gate; nothing
// here sends mail directly.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AllInError } from "@/lib/agents/lenders/all-in";
import { CreditBoxError } from "@/lib/agents/lenders/credit-box";
import { OutreachError, submitToLenders } from "@/lib/agents/lenders/outreach";
import { PackageCopyError } from "@/lib/agents/lenders/package";
import { indexRatesFromEnv, lenderRuntime, modelGateway, type LenderRuntime } from "@/lib/agents/lenders/runtime";
import { LenderMatchError, addStaffQuote, dealProfile, importLenderRegistrations, ingestTermSheets, reviewCreditBox, reviewQuote, saveCreditBox, setQuoteStatus, verifyCreditBox } from "@/lib/agents/lenders/service";
import { LenderStoreError } from "@/lib/agents/lenders/store";
import { quoteStatuses, type CreditBoxStatus, type QuoteStatus } from "@/lib/agents/lenders/types";
import { currentStaff } from "@/lib/deals/runtime";
import { StaffAccessError, requirePermission, type Permission, type StaffSession } from "@/lib/deals/session";
import { PackageError } from "@/lib/deals/packages";
import { MoneyError } from "@/lib/deals/money";
import { FormInputError, boxTermsFromForm, lines, list, metricsFromSource, quoteTermsFromForm } from "./_lib/forms";

const KNOWN = [StaffAccessError, CreditBoxError, LenderMatchError, LenderStoreError, OutreachError, PackageCopyError, PackageError, AllInError, FormInputError, MoneyError];

function messageOf(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (KNOWN.some((K) => err instanceof K)) return (err as Error).message;
  console.error("[lenders] action failed", err instanceof Error ? err.message : err);
  return "Something went wrong; nothing further was changed. Try again or check the audit log.";
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value.slice(0, 400))}`;

type Ctx = { staff: StaffSession; rt: LenderRuntime };

async function run(path: string, permission: Permission, fn: (ctx: Ctx) => Promise<string>): Promise<never> {
  let target: string;
  try {
    const staff = requirePermission(await currentStaff(), permission);
    const rt = lenderRuntime();
    if (!rt) throw new LenderMatchError("Lender matching storage is not configured");
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
const int = (f: FormData, k: string) => {
  const n = Number(str(f, k));
  if (!Number.isInteger(n)) throw new FormInputError(`${k} is missing`);
  return n;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dealPath = (id: string) => {
  if (!UUID.test(id)) throw new FormInputError("Unknown deal");
  return `/lenders/deals/${id}`;
};
/** Return path that keeps the deal-metrics query string the staff member was working with. */
function backTo(f: FormData): string {
  const id = str(f, "dealId");
  const base = UUID.test(id) ? `/lenders/deals/${id}` : "/lenders";
  const q = str(f, "returnQuery");
  return q && /^[\w=&%.+\-]*$/.test(q) ? `${base}?${q}` : base;
}

// Credit boxes ----------------------------------------------------------------------------

export async function importRegistrationsAction(): Promise<never> {
  return run("/lenders", "write", async ({ staff, rt }) => {
    const r = await importLenderRegistrations({ boxes: rt.store, partners: rt.partners, desk: rt.desk.store, now: rt.desk.now }, staff.actor);
    const parts = [`${r.created} new`, `${r.updated} refreshed`, `${r.unchanged} unchanged`, `${r.skipped} already reviewed`];
    return `Imported lender registrations: ${parts.join(", ")}.${r.errors.length ? ` ${r.errors.length} could not be read: ${r.errors.slice(0, 2).join("; ")}` : ""}`;
  });
}

export async function saveBoxAction(f: FormData): Promise<never> {
  const id = str(f, "boxId");
  let target = "/lenders";
  try {
    const staff = requirePermission(await currentStaff(), "write");
    const rt = lenderRuntime();
    if (!rt) throw new LenderMatchError("Lender matching storage is not configured");
    const box = await saveCreditBox(
      { boxes: rt.store, desk: rt.desk.store, now: rt.desk.now },
      { id: id || null, expectedVersion: str(f, "recordVersion") ? int(f, "recordVersion") : undefined, lenderId: str(f, "lenderId") || null, terms: boxTermsFromForm(f) },
      staff.actor,
    );
    target = withParam(`/lenders/boxes/${box.id}`, "notice", box.status === "pending_review" ? "Saved. The box is waiting for broker review before matching uses it." : "Saved.");
  } catch (err) {
    target = withParam(id ? `/lenders/boxes/${encodeURIComponent(id)}` : "/lenders/boxes/new", "error", messageOf(err));
  }
  revalidatePath("/lenders");
  redirect(target);
}

const REVIEW_OPS: Record<string, CreditBoxStatus | "verify"> = { approve: "approved", reject: "rejected", retire: "retired", reopen: "pending_review", verify: "verify" };

export async function reviewBoxAction(f: FormData): Promise<never> {
  const id = str(f, "boxId");
  const back = str(f, "back") === "box" && UUID.test(id) ? `/lenders/boxes/${id}` : "/lenders";
  return run(back, "write", async ({ staff, rt }) => {
    const op = REVIEW_OPS[str(f, "op")];
    if (!op) throw new FormInputError("Unknown review action");
    const deps = { boxes: rt.store, desk: rt.desk.store, now: rt.desk.now };
    if (op === "verify") {
      await verifyCreditBox(deps, id, int(f, "recordVersion"), staff.actor);
      return "Marked verified today.";
    }
    const box = await reviewCreditBox(deps, { id, expectedVersion: int(f, "recordVersion"), to: op, note: str(f, "note") || null, lenderId: str(f, "lenderId") || null, verify: str(f, "verify") === "on" }, staff.actor);
    return `${box.label}: ${box.status.replace("_", " ")}.`;
  });
}

// Outreach ---------------------------------------------------------------------------------

export async function submitOutreachAction(f: FormData): Promise<never> {
  const back = backTo(f);
  return run(back, "write", async ({ staff, rt }) => {
    const dealId = str(f, "dealId");
    dealPath(dealId);
    const deal = await rt.desk.store.getDeal(dealId);
    if (!deal) throw new LenderMatchError("Deal not found");
    const documentIds = list(f, "documentId");
    if (documentIds.length && !deal.leadId) throw new LenderMatchError("Link the deal to its lead so vault documents can be packaged");
    const items = documentIds.length && deal.leadId ? await rt.desk.vaultItems(deal.leadId, documentIds) : [];
    const metrics = metricsFromSource(f, deal.loanAmountCents);
    const includeSummary = str(f, "includeSummary") === "on";
    const asOf = rt.desk.now().toISOString().slice(0, 10);
    const r = await submitToLenders(rt.outreach, {
      dealId,
      profile: dealProfile(deal, metrics.overrides),
      lenderIds: list(f, "lenderId"),
      items,
      summary: includeSummary
        ? {
            asOf,
            assetClass: metrics.overrides.assetClass ?? null,
            spreads: metrics.spreads,
            highlights: lines(f, "highlights"),
            risks: lines(f, "risks"),
            purpose: str(f, "purpose") || null,
            advisor: { name: staff.name, email: staff.email, dreLicense: staff.dreLicense },
          }
        : null,
      actor: staff.actor,
      allowStaleLender: str(f, "allowStale") === "on",
      overrideReason: str(f, "overrideReason") || null,
      note: str(f, "note") || null,
    });
    // One-time share links (approved, no mailer configured) are shown once on the next view, never put in the URL.
    const urls = r.outcomes.flatMap((o) => (o.ok && o.result.shareUrl ? [{ lender: o.lenderName, url: o.result.shareUrl }] : []));
    if (urls.length) (await cookies()).set("lender_share_urls", JSON.stringify(urls), { httpOnly: true, secure: true, sameSite: "strict", path: `/lenders/deals/${dealId}`, maxAge: 120 });
    return r.outcomes.map((o) => `${o.lenderName}: ${o.ok ? o.message : o.error}`).join(" · ");
  });
}

// Quotes --------------------------------------------------------------------------------------

export async function ingestTermSheetsAction(f: FormData): Promise<never> {
  const back = backTo(f);
  return run(back, "write", async ({ staff, rt }) => {
    const dealId = str(f, "dealId");
    dealPath(dealId);
    const r = await ingestTermSheets({ quotes: rt.store, desk: rt.desk.store, mail: rt.mail, gateway: modelGateway(), now: rt.desk.now, indexRates: indexRatesFromEnv() }, { dealId, actor: staff.actor });
    if (!r.parsed && !r.errors.length) return r.skipped ? "No new term sheets; every routed term sheet already has a quote." : "No term sheets from lenders@ are routed to this deal yet.";
    return `Parsed ${r.parsed} term sheet${r.parsed === 1 ? "" : "s"}; ${r.needsReview} need${r.needsReview === 1 ? "s" : ""} review.${r.errors.length ? ` Errors: ${r.errors.slice(0, 2).join("; ")}` : ""}`;
  });
}

export async function addQuoteAction(f: FormData): Promise<never> {
  const back = backTo(f);
  return run(back, "write", async ({ staff, rt }) => {
    const dealId = str(f, "dealId");
    dealPath(dealId);
    const nonce = str(f, "nonce");
    if (!/^[\w-]{8,64}$/.test(nonce)) throw new FormInputError("Reload the page and try again");
    const q = await addStaffQuote({ quotes: rt.store, desk: rt.desk.store, now: rt.desk.now }, { dealId, lenderId: str(f, "lenderId") || null, terms: quoteTermsFromForm(f), idempotencyKey: `staff:${dealId}:${nonce}` }, staff.actor);
    return `Quote from ${q.lenderName} added: all-in ${q.allInRatePct?.toFixed(2)}%.`;
  });
}

export async function reviewQuoteAction(f: FormData): Promise<never> {
  const back = backTo(f);
  return run(back, "write", async ({ staff, rt }) => {
    const q = await reviewQuote({ quotes: rt.store, desk: rt.desk.store, now: rt.desk.now }, { quoteId: str(f, "quoteId"), terms: quoteTermsFromForm(f), lenderId: str(f, "lenderId") || null, note: str(f, "reviewNote") || null }, staff.actor);
    return `Quote from ${q.lenderName} reviewed: all-in ${q.allInRatePct?.toFixed(2)}%.`;
  });
}

export async function quoteStatusAction(f: FormData): Promise<never> {
  const back = backTo(f);
  return run(back, "write", async ({ staff, rt }) => {
    const to = str(f, "to") as QuoteStatus;
    if (!quoteStatuses.includes(to)) throw new FormInputError("Unknown quote status");
    const q = await setQuoteStatus({ quotes: rt.store, now: rt.desk.now }, str(f, "quoteId"), to, staff.actor, str(f, "note") || null);
    return `Quote from ${q.lenderName} marked ${q.status.replace("_", " ")}.`;
  });
}
