"use server";

// Server actions for market intel and prospecting. Each re-authenticates the
// staff member (role + MFA; a layout guard does not protect server actions),
// runs one operation from lib/agents/intel and redirects back with a notice or
// an error. Nothing here sends anything: outreach is requested through the
// broker approval gate and released only after approval (lib/agents/intel/outreach).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { staffForMutation, type StaffContext } from "@/lib/auth/dal";
import { IntelStoreError } from "@/lib/agents/intel/intel-store";
import { OutreachError, cancelOutreach, draftOutreach, markMailed, settleOutreach, settlePending } from "@/lib/agents/intel/outreach";
import { ProspectStoreError } from "@/lib/agents/intel/prospect-store";
import { ProspectingError, addSuppressionValue, scanProspects, suppressProspect } from "@/lib/agents/intel/prospects";
import { marketDeps, intelRuntime, outreachDeps, type IntelRuntime } from "@/lib/agents/intel/runtime";
import { runMarketIntel } from "@/lib/agents/intel/market";
import { SUPPRESSION_REASONS, type SuppressionReason } from "@/lib/agents/intel/types";
import { FormInputError, UUID, channelFromForm, idOf, intelEditFromForm, scanQueryFromForm, staffEditFromForm, str, suppressionSchema } from "./_lib/forms";

const KNOWN = [FormInputError, OutreachError, ProspectingError, ProspectStoreError, IntelStoreError];

function messageOf(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => i.message).join("; ");
  if (KNOWN.some((K) => err instanceof K)) return (err as Error).message;
  console.error("[prospects] action failed", err instanceof Error ? err.message : err);
  return "Something went wrong and nothing further was changed. Try again, or check the audit log.";
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value.slice(0, 400))}`;

type Ctx = { ctx: StaffContext; rt: IntelRuntime; actor: string };

async function run(path: string, fn: (c: Ctx) => Promise<string>): Promise<never> {
  let target: string;
  try {
    const auth = await staffForMutation();
    if (!auth.ok) throw new FormInputError(auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again.");
    const rt = await intelRuntime();
    if (!rt) throw new FormInputError("Prospecting storage is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
    const actor = `staff:${auth.ctx.principal.email.toLowerCase()}`;
    target = withParam(path, "notice", await fn({ ctx: auth.ctx, rt, actor }));
  } catch (err) {
    target = withParam(path, "error", messageOf(err));
  }
  revalidatePath(path.split("?")[0]!);
  redirect(target);
}

/** Where to land after a prospect action. A malformed id lands on the list; the action itself then reports it. */
const prospectPath = (f: FormData) => (UUID.test(str(f, "prospectId")) ? `/prospects/${str(f, "prospectId")}` : "/prospects");

// Market intel -------------------------------------------------------------------------

export async function generateIntelAction(f: FormData): Promise<never> {
  const focus = str(f, "focus").slice(0, 200) || null;
  return run("/prospects/intel", async ({ rt, actor }) => {
    const r = await runMarketIntel(marketDeps(rt), { focus, actor });
    if (r.status === "no_signals") return `No public signals were available${r.errors.length ? ` (${r.errors.join("; ")})` : ""}. Nothing was drafted.`;
    if (r.status === "audit_only") return "Audit mode: the note was proposed to the audit trail only.";
    return `Draft ready for review (${r.usedModel ? "written by the market-intel model" : "rules digest"}, ${r.draft.signals.length} signals).`;
  });
}

const intelPath = (f: FormData) => (UUID.test(str(f, "id")) ? `/prospects/intel/${str(f, "id")}` : "/prospects/intel");

export async function editIntelAction(f: FormData): Promise<never> {
  return run(intelPath(f), async ({ rt, actor }) => {
    const id = idOf(f);
    const draft = await rt.intel.getDraft(id);
    if (!draft) throw new FormInputError("That draft no longer exists.");
    const saved = await rt.intel.editDraft(id, intelEditFromForm(f, draft), actor, rt.now());
    if (!saved) throw new FormInputError("Only a draft that is waiting for review can be edited.");
    return "Edits saved.";
  });
}

export async function reviewIntelAction(f: FormData): Promise<never> {
  const decision = str(f, "decision");
  return run(intelPath(f), async ({ rt, actor }) => {
    const id = idOf(f);
    if (decision !== "approved" && decision !== "rejected") throw new FormInputError("Choose approve or reject.");
    const done = await rt.intel.reviewDraft(id, { decision, by: actor, note: str(f, "note") || null }, rt.now());
    if (!done) throw new FormInputError("That draft was already decided.");
    return decision === "approved" ? "Approved for internal use. Nothing was published or sent." : "Rejected.";
  });
}

// Prospects ----------------------------------------------------------------------------

export async function scanAction(f: FormData): Promise<never> {
  return run("/prospects", async ({ rt, actor }) => {
    const r = await scanProspects({ provider: rt.provider, store: rt.prospects, events: rt.events, now: rt.now, marketRatePct: rt.marketRatePct }, { query: scanQueryFromForm(f), actor });
    if (r.status === "not_configured") return "No recorded-mortgage provider is configured (set ATTOM_API_KEY). Nothing was scanned.";
    if (r.status === "failed") throw new ProspectingError(`The scan failed (${r.error}). No prospects were changed.`);
    return `Scan complete: ${r.found} found, ${r.created} new, ${r.updated} refreshed${r.skipped ? `, ${r.skipped} skipped` : ""}${r.suppressed ? `, ${r.suppressed} on the do-not-contact list` : ""}.`;
  });
}

export async function updateProspectAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt, actor }) => {
    const p = await rt.prospects.updateStaff(idOf(f, "prospectId"), staffEditFromForm(f), actor, rt.now());
    if (!p) throw new FormInputError("That prospect no longer exists.");
    return "Saved.";
  });
}

export async function draftOutreachAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt, actor }) => {
    const r = await draftOutreach(outreachDeps(rt), { prospectId: idOf(f, "prospectId"), channel: channelFromForm(f), actor, personalize: f.get("personalize") === "on" });
    if (r.status === "audit_only") return "Audit mode: the draft was proposed to the audit trail only.";
    return r.reused ? "That message is already waiting for broker approval." : "Draft sent to the approvals queue. It goes out only after a broker approves it.";
  });
}

export async function settleOutreachAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt }) => {
    const r = await settleOutreach(outreachDeps(rt), idOf(f, "outreachId"));
    if (r.outreach.status === "sent") return "Approved and sent.";
    if (r.outreach.status === "ready_to_mail") return "Approved. The letter is ready to mail.";
    if (r.outreach.status === "rejected" || r.outreach.status === "expired") return `Not sent: ${r.outreach.status === "rejected" ? "a broker rejected it" : "the approval expired"}.`;
    if (r.outreach.status === "blocked") return `Blocked: ${r.outreach.error ?? "a safeguard stopped it"}. Nothing was sent.`;
    return r.note ?? "Still waiting for broker approval.";
  });
}

export async function settleAllAction(): Promise<never> {
  return run("/prospects", async ({ rt }) => {
    const r = await settlePending(outreachDeps(rt));
    return `Checked ${r.checked} waiting drafts: ${r.sent} sent, ${r.readyToMail} ready to mail, ${r.rejected} rejected, ${r.expired} expired, ${r.blocked} blocked, ${r.waiting} still waiting.`;
  });
}

export async function markMailedAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt, actor }) => {
    await markMailed(outreachDeps(rt), idOf(f, "outreachId"), actor);
    return "Marked as mailed.";
  });
}

export async function cancelOutreachAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt, actor }) => {
    await cancelOutreach(outreachDeps(rt), idOf(f, "outreachId"), actor);
    return "Draft cancelled.";
  });
}

export async function suppressProspectAction(f: FormData): Promise<never> {
  const path = prospectPath(f);
  return run(path, async ({ rt, actor }) => {
    const reason = (SUPPRESSION_REASONS as readonly string[]).includes(str(f, "reason")) ? (str(f, "reason") as SuppressionReason) : "staff";
    const r = await suppressProspect({ store: rt.prospects, events: rt.events, now: rt.now }, idOf(f, "prospectId"), reason, actor);
    return `Added to the do-not-contact list (${r.added.length} entries).`;
  });
}

export async function addSuppressionAction(f: FormData): Promise<never> {
  return run("/prospects/suppressions", async ({ rt, actor }) => {
    const input = suppressionSchema.parse({ kind: str(f, "kind"), value: str(f, "value"), reason: str(f, "reason") });
    const r = await addSuppressionValue({ store: rt.prospects, now: rt.now }, { ...input, actor });
    return `Added ${r.suppression.label}. ${r.prospectsMarked} prospect${r.prospectsMarked === 1 ? "" : "s"} marked do not contact.`;
  });
}
