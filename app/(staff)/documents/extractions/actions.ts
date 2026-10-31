"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { correctAndApprove, rejectExtraction, ReviewError } from "@/lib/agents/documents/review";
import { documentReviewDeps } from "@/lib/agents/documents/server";
import { specFor } from "@/lib/agents/documents/specs";
import type { FieldValue } from "@/lib/agents/documents/types";
import { staffForMutation } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { sendWorkflowEvent } from "@/lib/workflows/client";
import { EVENTS } from "@/lib/workflows/events";

// Approve (with corrections) or reject an extraction from the review queue.
// Each action re-authenticates the caller and re-checks the capability; the
// review service enforces the lifecycle (compare-and-set on status). An
// approved extraction feeds spreads and Jev re-sizing through
// kubera/document.extracted. Values never go into events or logs.

export type ReviewState = { ok?: boolean; message?: string };

const idSchema = z.uuid();
const FIELD_PREFIX = "f.";

async function authorized(): Promise<{ ok: true; reviewer: string } | { ok: false; message: string }> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, message: auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again." };
  const check = can(auth.ctx.principal, "review_extractions", californiaDate(new Date()));
  if (!check.ok) return { ok: false, message: check.reason };
  return { ok: true, reviewer: auth.ctx.principal.email };
}

const reviewMessage = (err: ReviewError): string =>
  err.code === "conflict" || err.code === "not_reviewable" ? `This extraction can no longer be changed here: ${err.message}.` : `Not approved: ${err.message}.`;

export async function approveExtractionAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const who = await authorized();
  if (!who.ok) return { ok: false, message: who.message };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "That extraction could not be read. Reload the page and try again." };
  const deps = await documentReviewDeps();
  if (!deps) return { ok: false, message: "The extraction review queue is not configured." };
  const rec = await deps.store.get(id.data);
  if (!rec || !rec.doc_type) return { ok: false, message: "That extraction no longer exists." };

  // Only fields whose value the reviewer changed become corrections.
  const scalars: Record<string, FieldValue> = {};
  for (const f of specFor(rec.doc_type).scalars) {
    const raw = formData.get(`${FIELD_PREFIX}${f.key}`);
    if (typeof raw !== "string") continue;
    const typed = raw.trim().slice(0, 200);
    const current = rec.fields.scalars[f.key]?.value;
    const shown = current === null || current === undefined ? "" : String(current);
    if (typed !== shown) scalars[f.key] = typed === "" ? null : typed;
  }
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || undefined;
  let approved;
  try {
    approved = await correctAndApprove(deps, rec.id, { reviewer: who.reviewer, corrections: { scalars }, ...(notes ? { notes } : {}) });
  } catch (err) {
    if (err instanceof ReviewError) return { ok: false, message: reviewMessage(err) };
    throw err;
  }
  try {
    await sendWorkflowEvent({
      name: EVENTS.documentExtracted,
      id: `document-extracted:${approved.id}:approved`,
      data: { extractionId: approved.id, documentId: approved.document_id, dealId: approved.deal_id, leadId: approved.lead_id, docType: approved.doc_type, status: approved.status },
    });
  } catch (err) {
    console.warn("[documents] spreads wake-up failed after approval", err instanceof Error ? err.message : err);
  }
  redirect(`/documents/extractions?approved=${approved.id}`);
}

export async function rejectExtractionAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const who = await authorized();
  if (!who.ok) return { ok: false, message: who.message };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "That extraction could not be read. Reload the page and try again." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!reason) return { ok: false, message: "Add a short reason, for example which document should replace it." };
  const deps = await documentReviewDeps();
  if (!deps) return { ok: false, message: "The extraction review queue is not configured." };
  try {
    await rejectExtraction(deps, id.data, { reviewer: who.reviewer, reason });
  } catch (err) {
    if (err instanceof ReviewError) {
      refresh();
      return { ok: false, message: reviewMessage(err) };
    }
    throw err;
  }
  redirect(`/documents/extractions?rejected=${id.data}`);
}
