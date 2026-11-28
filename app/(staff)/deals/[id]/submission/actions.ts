"use server";

// Server actions for the lender submission editor and preview. Each verifies
// the staff session and the write permission itself (analysts can read the
// pages but never reach these), parses the posted form, and goes through the
// adapter in ./_lib/data.ts. Section saves and approval requests return their
// result instead of redirecting, so a refused form keeps what was typed.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/deals/runtime";
import { StaffAccessError, requirePermission } from "@/lib/deals/session";
import { ConcurrentUpdateError } from "@/lib/deals/store";
import { isTargetStage, submissionSections, type SectionId } from "@/lib/deals/submission/types";
import { SubmissionDataError, applyPrefill, loadSubmissionView, requestSubmission, saveSection, sectionLabel, type MissingItem } from "./_lib/data";
import { parseSectionForm, type FieldError } from "./_lib/fields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const ids = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0);

const editorPath = (id: string) => `/deals/${id}/submission`;

function dealIdOf(f: FormData): string {
  const id = str(f, "dealId");
  if (!UUID.test(id)) throw new SubmissionDataError("Unknown deal");
  return id;
}

const CONFLICT = "Someone saved this submission after this page loaded, so nothing was saved. Your typing is still in the form: copy it, reload the page, and save again.";

function messageOf(err: unknown): string {
  if (err instanceof ConcurrentUpdateError) return CONFLICT;
  if (err instanceof StaffAccessError || err instanceof SubmissionDataError) return err.message;
  console.error("[submission] action failed", err instanceof Error ? err.message : err);
  return "Something went wrong; nothing was saved. Try again.";
}

function revalidateDeal(id: string) {
  revalidatePath(editorPath(id));
  revalidatePath(`${editorPath(id)}/preview`);
  revalidatePath(`/deals/${id}`);
}

// Sections ----------------------------------------------------------------------------

/** What a section form gets back: a message, every field problem by its visible label, and `at` so a repeat is a new state. */
export type SectionFormState = { error?: string; errors?: FieldError[]; notice?: string; at?: number };

export async function saveSubmissionSectionAction(_prev: SectionFormState, f: FormData): Promise<SectionFormState> {
  try {
    const staff = requirePermission(await currentStaff(), "write");
    const id = dealIdOf(f);
    const section = str(f, "section") as SectionId;
    if (!(submissionSections as readonly string[]).includes(section) || section === "documents") throw new SubmissionDataError("Unknown section");
    const view = await loadSubmissionView(id);
    if (!view) throw new SubmissionDataError("Deal not found");
    if (!view.sections.some((s) => s.id === section && s.view === "form")) throw new SubmissionDataError(`${sectionLabel(section)} is not part of the ${view.playbook.replace(/_/g, " ")} playbook`);
    const { values, errors } = parseSectionForm(section, f, {
      playbook: view.playbook,
      allowedPlaybooks: view.allowedPlaybooks,
      profile: view.ctx.profile,
      sponsor: view.ctx.sponsor,
      actor: staff.actor,
      at: view.ctx.now.toISOString(),
    });
    if (!values) return { error: `Nothing was saved. Fix ${errors.length === 1 ? "this field" : `these ${errors.length} fields`}:`, errors, at: Date.now() };
    const raw = str(f, "version");
    const expected = raw === "" ? null : Number(raw);
    if (expected !== null && !Number.isInteger(expected)) throw new SubmissionDataError("Reload the page and try again");
    await saveSection(id, section, values, expected, staff.actor);
    revalidateDeal(id);
    return { notice: `${sectionLabel(section)} saved.`, at: Date.now() };
  } catch (err) {
    return { error: messageOf(err), at: Date.now() };
  }
}

/** "Start from these": writes the suggested values; nothing is written before this. */
export async function applyPrefillAction(f: FormData): Promise<never> {
  const id = str(f, "dealId");
  const path = UUID.test(id) ? editorPath(id) : "/deals";
  let target: string;
  try {
    const staff = requirePermission(await currentStaff(), "write");
    const { fields } = await applyPrefill(dealIdOf(f), staff.actor);
    revalidateDeal(id);
    target = `${path}?notice=${encodeURIComponent(`Started from ${fields} suggested value${fields === 1 ? "" : "s"}. Each keeps its source tag until you change it.`)}`;
  } catch (err) {
    target = `${path}?error=${encodeURIComponent(messageOf(err).slice(0, 400))}`;
  }
  redirect(target);
}

// The request --------------------------------------------------------------------------

export type RequestFormState = { error?: string; missing?: MissingItem[]; notice?: string; results?: { lenderName: string; ok: boolean; message: string }[]; at?: number };

/**
 * Requests broker approval to submit to the chosen lenders. With required
 * items missing and no reason of 20+ characters, nothing is locked or
 * requested and the missing items come back. A one-time share link (approved
 * already, email to lenders off) is shown once on the deal page, never in a URL.
 */
export async function requestSubmissionAction(_prev: RequestFormState, f: FormData): Promise<RequestFormState> {
  try {
    const staff = requirePermission(await currentStaff(), "write");
    const id = dealIdOf(f);
    const stage = str(f, "stage");
    if (!isTargetStage(stage)) throw new SubmissionDataError("Pick what to ask the lender for");
    const r = await requestSubmission(
      { dealId: id, lenderIds: ids(f, "lenderId"), stage, documentIds: ids(f, "documentId"), overrideReason: str(f, "overrideReason") || null, note: str(f, "note") || null, allowStaleLender: f.get("allowStale") === "on" },
      staff,
    );
    if (!r.ok) return { error: r.message, ...(r.reason === "not_ready" ? { missing: r.missing } : {}), at: Date.now() };
    const share = r.outcomes.find((o) => o.shareUrl)?.shareUrl;
    if (share) (await cookies()).set("deal_share_url", share, { httpOnly: true, secure: true, sameSite: "strict", path: `/deals/${id}`, maxAge: 120 });
    revalidateDeal(id);
    revalidatePath("/approvals");
    const results = r.outcomes.map((o) => ({ lenderName: o.lenderName, ok: o.ok, message: o.message }));
    const sent = results.filter((o) => o.ok).length;
    return sent === results.length
      ? { notice: `Requested broker approval for ${sent} lender${sent === 1 ? "" : "s"}. Nothing is sent until a broker approves.`, results, at: Date.now() }
      : { error: `${results.length - sent} of ${results.length} lender${results.length === 1 ? "" : "s"} could not be requested.`, results, at: Date.now() };
  } catch (err) {
    return { error: messageOf(err), at: Date.now() };
  }
}
