"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CONDITION_STATUSES } from "@/lib/checklists/conditions";
import { checklistDeps, deskServices, principalDeps, screeningDeps } from "@/lib/checklists/server";
import { addCondition, createDealChecklist, moveCondition, moveItem, recordContractorLicense, saveHmUnderwriting, syncDealPrincipalItems } from "@/lib/checklists/service";
import { canDecide, interimStaffConfigured, STAFF_COOKIE, staffCookieValue, verifyStaffToken } from "@/lib/checklists/staff";
import { CHECKLIST_PROGRAMS, ITEM_STATUSES } from "@/lib/checklists/types";
import { issuePortalInvite } from "@/lib/principals/portal";
import { addPrincipal, removePrincipal } from "@/lib/principals/service";
import { PRINCIPAL_ROLES } from "@/lib/principals/types";
import { dispositionScreening, screenDeal } from "@/lib/screening/service";
import { SCREENING_DISPOSITIONS } from "@/lib/screening/types";
import { site } from "@/lib/site";
import { requireStaff, StaffAuthError } from "./_lib/session";
import { parseScopeLines, parseTrackRecordLines } from "./_lib/hm-lines";

const uuid = z.uuid();
const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const optional = (f: FormData, k: string) => text(f, k) || null;
const num = (f: FormData, k: string) => {
  const v = text(f, k).replace(/[$,%\s]/g, "");
  return v === "" ? null : Number(v);
};

/** Known, user-safe error messages; anything else is logged and replaced with a generic message. */
function messageOf(err: unknown): string {
  if (err instanceof StaffAuthError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Check the form.";
  if (err instanceof Error && ["ChecklistError", "PrincipalInputError", "ScreeningReviewError", "InvalidSecretError", "ConcurrentUpdateError", "PrincipalConcurrencyError", "DispositionConflictError", "DuplicateChecklistError", "ItemTransitionError", "ConditionTransitionError", "PiiKeyError"].includes(err.name)) {
    return err.name === "PiiKeyError" ? "Encryption is not configured (PII_ENCRYPTION_KEY), so tax ids, birth dates and financial statements cannot be stored." : err.message;
  }
  console.error("[checklists] action failed", err instanceof Error ? err.message : err);
  return "Something went wrong. Nothing was saved; try again.";
}

function deskUrl(dealId: string | null, params: Record<string, string>, anchor?: string): string {
  const qs = new URLSearchParams(dealId ? { id: dealId, ...params } : params).toString();
  return `${dealId ? "/checklists/deal" : "/checklists"}${qs ? `?${qs}` : ""}${anchor ? `#${anchor}` : ""}`;
}

/** Runs a desk action and redirects back with a notice (redirect() throws, so it stays outside the try). */
async function run(dealId: string | null, anchor: string, fn: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = deskUrl(dealId, { ok: await fn() }, anchor);
  } catch (err) {
    target = deskUrl(dealId, { error: messageOf(err) }, anchor);
  }
  redirect(target);
}

function services() {
  const s = deskServices();
  if (!s) throw new Error("The deal desk is not configured (Supabase).");
  return s;
}

function dealIdOf(f: FormData): string {
  return uuid.parse(text(f, "dealId"));
}

// --- Session -----------------------------------------------------------------------------------

export async function signIn(formData: FormData): Promise<void> {
  if (!interimStaffConfigured() || !verifyStaffToken(text(formData, "token"))) redirect(deskUrl(null, { error: "That access token is not valid." }));
  const jar = await cookies();
  jar.set(STAFF_COOKIE, staffCookieValue(process.env.STAFF_ACCESS_TOKEN!.trim()), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 12 * 3600 });
  redirect("/checklists");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
  redirect("/checklists");
}

// --- Checklists and items ---------------------------------------------------------------------------

export async function createChecklistAction(formData: FormData): Promise<void> {
  const dealId = uuid.safeParse(text(formData, "dealId"));
  if (!dealId.success) redirect(deskUrl(null, { error: "Enter the deal id (a UUID from the pipeline)." }));
  await run(dealId.data, "checklists", async () => {
    const staff = await requireStaff();
    const program = z.enum(CHECKLIST_PROGRAMS).parse(text(formData, "program"));
    const leadId = optional(formData, "leadId");
    const s = services();
    await createDealChecklist(checklistDeps(s), { dealId: dealId.data, program, leadId: leadId ? uuid.parse(leadId) : null, createdBy: staff.email });
    await syncDealPrincipalItems(checklistDeps(s), dealId.data);
    return "Checklist created.";
  });
}

export async function moveItemAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, `item-${text(formData, "itemId")}`, async () => {
    const staff = await requireStaff();
    const to = z.enum(ITEM_STATUSES).parse(text(formData, "to"));
    if ((to === "waived" || to === "not_applicable") && !canDecide(staff)) throw new StaffAuthError();
    await moveItem(checklistDeps(services()), { dealId, itemId: uuid.parse(text(formData, "itemId")), expectedVersion: Number(text(formData, "version")), to, actor: { kind: "staff", id: staff.email }, note: optional(formData, "note"), documentDate: optional(formData, "documentDate") });
    return "Item updated.";
  });
}

export async function recordCslbAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, `item-${text(formData, "itemId")}`, async () => {
    const staff = await requireStaff();
    await recordContractorLicense(checklistDeps(services()), {
      itemId: uuid.parse(text(formData, "itemId")),
      expectedVersion: Number(text(formData, "version")),
      staffEmail: staff.email,
      verification: {
        licenseNumber: text(formData, "licenseNumber"),
        businessName: text(formData, "businessName"),
        status: text(formData, "status") as "active",
        classifications: text(formData, "classifications").split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()),
        expiresOn: optional(formData, "expiresOn"),
        bondOnFile: formData.get("bondOnFile") === "on",
        workersCompOnFile: formData.get("workersCompOnFile") === "on",
      },
    });
    return "License check recorded.";
  });
}

// --- Conditions ---------------------------------------------------------------------------------------

export async function addConditionAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "conditions", async () => {
    const staff = await requireStaff();
    await addCondition(
      checklistDeps(services()),
      { dealId, source: text(formData, "source") as "lender", lenderName: optional(formData, "lenderName"), timing: text(formData, "timing") as "prior_to_closing", description: text(formData, "description"), responsible: text(formData, "responsible") as "borrower", dueDate: optional(formData, "dueDate"), checklistItemId: optional(formData, "checklistItemId") },
      staff.email,
    );
    return "Condition added.";
  });
}

export async function moveConditionAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "conditions", async () => {
    const staff = await requireStaff();
    const to = z.enum(CONDITION_STATUSES).parse(text(formData, "to"));
    if (to === "waived" && !canDecide(staff)) throw new StaffAuthError();
    await moveCondition(checklistDeps(services()), { conditionId: uuid.parse(text(formData, "conditionId")), expectedVersion: Number(text(formData, "version")), to, staffEmail: staff.email, note: optional(formData, "note"), waiverEvidence: optional(formData, "waiverEvidence") });
    return "Condition updated.";
  });
}

// --- Principals ---------------------------------------------------------------------------------------

export async function addPrincipalAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "principals", async () => {
    await requireStaff();
    const s = services();
    const roles = formData.getAll("roles").filter((r): r is string => typeof r === "string");
    const kind = text(formData, "kind") === "entity" ? "entity" : "individual";
    const ssn = optional(formData, "ssn");
    const dob = optional(formData, "dob");
    const result = await addPrincipal(
      principalDeps(s),
      {
        dealId,
        parentId: optional(formData, "parentId"),
        kind,
        legalName: text(formData, "legalName"),
        roles: z.array(z.enum(PRINCIPAL_ROLES)).parse(roles),
        title: optional(formData, "title"),
        ownershipPct: num(formData, "ownershipPct"),
        isGuarantor: formData.get("isGuarantor") === "on",
        email: optional(formData, "email"),
        phone: optional(formData, "phone"),
        formationState: kind === "entity" ? optional(formData, "formationState") : null,
        citizenship: kind === "individual" ? (optional(formData, "citizenship") as "us_citizen" | null) : null,
      },
      { ...(ssn ? { ssn } : {}), ...(dob ? { dob } : {}) },
    );
    const sync = await syncDealPrincipalItems(checklistDeps(s), dealId);
    const dup = result.duplicates.length ? ` The same tax id is on file for ${result.duplicates.map((d) => d.legalName).join(", ")} on another deal.` : "";
    return `${result.principal.legalName} added; ${sync.added} checklist item(s) added.${dup}`;
  });
}

export async function removePrincipalAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "principals", async () => {
    const staff = await requireStaff();
    if (!canDecide(staff)) throw new StaffAuthError();
    const s = services();
    const p = await s.principals.get(uuid.parse(text(formData, "principalId")));
    if (!p || p.dealId !== dealId) throw new Error("not found");
    await removePrincipal(principalDeps(s), p.id);
    await syncDealPrincipalItems(checklistDeps(s), dealId);
    return `${p.legalName} removed.`;
  });
}

// --- Screening ---------------------------------------------------------------------------------------------

export async function runScreeningAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "screening", async () => {
    const staff = await requireStaff();
    const purpose = text(formData, "purpose") === "rescreen_pre_closing" ? "rescreen_pre_closing" : "initial";
    const { records, gate } = await screenDeal(screeningDeps(services()), { dealId, purpose, requestedBy: staff.email });
    const hits = records.filter((r) => r.result === "potential_match").length;
    const errors = records.filter((r) => r.result === "error").length;
    return `Screened ${records.length} principal(s): ${hits} possible match(es), ${errors} error(s).${gate.held ? " The deal is on hold." : ""}`;
  });
}

export async function dispositionAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "screening", async () => {
    const staff = await requireStaff();
    const s = services();
    const screening = await s.screenings.get(uuid.parse(text(formData, "screeningId")));
    if (!screening || screening.dealId !== dealId) throw new Error("not found");
    await dispositionScreening(screeningDeps(s), { screeningId: screening.id, to: z.enum(SCREENING_DISPOSITIONS).parse(text(formData, "to")), reviewer: staff, note: text(formData, "note") });
    return "Review recorded.";
  });
}

// --- Portal invites (useActionState: the link is shown once, never put in a URL) ------------------------------

export type InviteState = { url?: string; email?: string; message?: string; error?: string };

export async function issueInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  try {
    const staff = await requireStaff();
    if (!canDecide(staff)) throw new StaffAuthError();
    const dealId = dealIdOf(formData);
    const s = services();
    const principalId = optional(formData, "principalId");
    let email = z.email().parse(text(formData, "email").toLowerCase());
    if (principalId) {
      const p = await s.principals.get(uuid.parse(principalId));
      if (!p || p.dealId !== dealId) throw new Error("not found");
      email = p.email ?? email;
    }
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    const origin = host ? `${proto}://${host}` : site.siteUrl;
    const issued = await issuePortalInvite(s.invites, { dealId, principalId, email, issuedBy: staff.email, origin, now: s.now?.() ?? new Date() }, { gate: s.gate });
    const status = issued.email === "approved" ? "A broker cleared the invitation email and it is queued." : "The invitation email is waiting in the approvals queue; you can also send this link from your own mailbox.";
    return { url: issued.url, email: issued.invite.email, message: `Link for ${issued.invite.email}, valid until ${new Date(issued.invite.expiresAt).toUTCString()}. ${status}` };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "portal", async () => {
    const staff = await requireStaff();
    if (!canDecide(staff)) throw new StaffAuthError();
    const s = services();
    const invite = await s.invites.get(uuid.parse(text(formData, "inviteId")));
    if (!invite || invite.dealId !== dealId) throw new Error("not found");
    await s.invites.revoke(invite.id, s.now?.() ?? new Date());
    return "Link revoked; any portal session from it has ended.";
  });
}

// --- Hard money file ----------------------------------------------------------------------------------------

export async function saveHmAction(formData: FormData): Promise<void> {
  const dealId = dealIdOf(formData);
  await run(dealId, "hard-money", async () => {
    const staff = await requireStaff();
    const version = text(formData, "version");
    await saveHmUnderwriting(
      checklistDeps(services()),
      {
        dealId,
        strategy: text(formData, "strategy") === "BRIDGE" ? "BRIDGE" : "FIX_AND_FLIP",
        purpose: text(formData, "purpose") === "REFINANCE" ? "REFINANCE" : "PURCHASE",
        purchasePrice: num(formData, "purchasePrice") ?? 0,
        asIsValue: num(formData, "asIsValue") ?? 0,
        arv: num(formData, "arv") ?? 0,
        arvSource: (text(formData, "arvSource") || "sponsor_estimate") as "appraisal",
        requestedLoanAmount: num(formData, "requestedLoanAmount") ?? 0,
        contingencyPct: num(formData, "contingencyPct") ?? 0,
        scopeOfWork: parseScopeLines(text(formData, "scopeOfWork")),
        trackRecord: parseTrackRecordLines(text(formData, "trackRecord")),
        exitPlan: {
          type: text(formData, "exitType") === "refinance" ? "refinance" : "sale",
          targetMonths: num(formData, "exitMonths") ?? 12,
          expectedSalePrice: num(formData, "expectedSalePrice") ?? undefined,
          refinanceProgram: optional(formData, "refinanceProgram") ?? undefined,
          refinanceLoanAmount: num(formData, "refinanceLoanAmount") ?? undefined,
          notes: optional(formData, "exitNotes") ?? undefined,
        },
        notes: optional(formData, "notes") ?? undefined,
      },
      staff.email,
      version ? Number(version) : null,
    );
    return "Hard money file saved.";
  });
}
