"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { staffForMutation, type StaffContext } from "@/lib/auth/dal";
import { ANNOTATION_LABELS, ANNOTATION_NOTE_MAX, FLAG_REASON_MAX, REVIEW_STATUSES } from "@/lib/ai/review/types";
import { reviewStoreFor } from "./_lib/runtime";

// Staff supervision of Ask Corin AI conversations: flag, set review status,
// annotate. Each action re-authenticates (staff role + MFA), so a page left
// open past sign-out cannot write. Any staff member may review.

export type ReviewState = { ok?: boolean; message?: string };

const id = z.uuid();

async function authorize(): Promise<{ ok: true; ctx: StaffContext } | { ok: false; state: ReviewState }> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, state: { ok: false, message: auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again." } };
  return { ok: true, ctx: auth.ctx };
}

const actor = (ctx: StaffContext) => `staff:${ctx.principal.email.toLowerCase()}`;

export async function flagAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const auth = await authorize();
  if (!auth.ok) return auth.state;
  const parsed = z
    .object({ id, flagged: z.enum(["true", "false"]), reason: z.string().trim().max(FLAG_REASON_MAX, `Keep the reason under ${FLAG_REASON_MAX} characters`).optional() })
    .safeParse({ id: formData.get("id"), flagged: formData.get("flagged"), reason: formData.get("reason") ?? undefined });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That request could not be read. Reload the page and try again." };
  const flagged = parsed.data.flagged === "true";
  if (flagged && !parsed.data.reason) return { ok: false, message: "Add a short reason so the next reviewer knows what to look at." };

  const store = reviewStoreFor(auth.ctx.services);
  if (!store) return { ok: false, message: "The review queue is not configured." };
  const done = await store.setFlag(parsed.data.id, { flagged, reason: parsed.data.reason ?? null, by: actor(auth.ctx) });
  if (!done) return { ok: false, message: "That conversation no longer exists." };
  refresh();
  return { ok: true, message: flagged ? "Flagged for review." : "Flag removed." };
}

export async function reviewStatusAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const auth = await authorize();
  if (!auth.ok) return auth.state;
  const parsed = z.object({ id, status: z.enum(REVIEW_STATUSES) }).safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return { ok: false, message: "That request could not be read. Reload the page and try again." };

  const store = reviewStoreFor(auth.ctx.services);
  if (!store) return { ok: false, message: "The review queue is not configured." };
  const done = await store.setReviewStatus(parsed.data.id, parsed.data.status, actor(auth.ctx));
  if (!done) return { ok: false, message: "That conversation no longer exists." };
  refresh();
  return { ok: true, message: parsed.data.status === "reviewed" ? "Marked reviewed." : parsed.data.status === "in_review" ? "Marked in review." : "Reopened." };
}

export async function annotateAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const auth = await authorize();
  if (!auth.ok) return auth.state;
  const rawIndex = formData.get("messageIndex");
  const parsed = z
    .object({
      id,
      messageIndex: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
      label: z.enum(ANNOTATION_LABELS),
      note: z.string().trim().min(1, "Write a note").max(ANNOTATION_NOTE_MAX, `Keep the note under ${ANNOTATION_NOTE_MAX} characters`),
    })
    .safeParse({ id: formData.get("id"), messageIndex: typeof rawIndex === "string" ? rawIndex : "", label: formData.get("label"), note: formData.get("note") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That request could not be read. Reload the page and try again." };

  const store = reviewStoreFor(auth.ctx.services);
  if (!store) return { ok: false, message: "The review queue is not configured." };
  const { principal } = auth.ctx;
  const saved = await store.addAnnotation({
    conversationId: parsed.data.id,
    messageIndex: parsed.data.messageIndex,
    label: parsed.data.label,
    note: parsed.data.note,
    authorId: principal.userId,
    authorLabel: principal.displayName || principal.email,
  });
  if (!saved) return { ok: false, message: "The note could not be saved. The conversation or message may no longer exist." };
  refresh();
  return { ok: true, message: "Note added." };
}
