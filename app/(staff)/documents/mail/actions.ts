"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { staffForMutation } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { assignReviewedMail, dismissReviewedMail } from "@/lib/mail/review";
import { mailReviewDeps } from "@/lib/mail/server";

// File or dismiss a message from the mail review queue. Each action
// re-authenticates the caller and re-checks the capability; the store closes a
// review with compare-and-set, so two people acting on one message cannot
// both win. Results go back as query parameters (ids and counts, never content).

const idSchema = z.uuid();
const back = (params: Record<string, string | number>) => `/documents/mail?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;

async function authorized(): Promise<{ ok: true; reviewer: string; mode: "supabase" | "fake" } | { ok: false; error: string }> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, error: auth.reason === "mfa_required" ? "mfa" : "signed_out" };
  const check = can(auth.ctx.principal, "review_mail", californiaDate(new Date()));
  if (!check.ok) return { ok: false, error: "forbidden" };
  return { ok: true, reviewer: auth.ctx.principal.email, mode: auth.ctx.services.mode };
}

export async function assignMailAction(formData: FormData): Promise<void> {
  const who = await authorized();
  if (!who.ok) redirect(back({ error: who.error }));
  const id = idSchema.safeParse(formData.get("id"));
  const target = String(formData.get("target") ?? "").slice(0, 80);
  if (!id.success) redirect(back({ error: "bad_request" }));
  const deps = mailReviewDeps(who.mode);
  if (!deps) redirect(back({ error: "not_configured" }));
  const res = await assignReviewedMail(deps, id.data, who.reviewer, target);
  if (!res.ok) redirect(back({ error: res.code }));
  redirect(back({ assigned: id.data, registered: res.registered, failed: res.failed, held: res.heldBack }));
}

export async function dismissMailAction(formData: FormData): Promise<void> {
  const who = await authorized();
  if (!who.ok) redirect(back({ error: who.error }));
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) redirect(back({ error: "bad_request" }));
  const deps = mailReviewDeps(who.mode);
  if (!deps) redirect(back({ error: "not_configured" }));
  const res = await dismissReviewedMail(deps, id.data, who.reviewer);
  if (!res.ok) redirect(back({ error: res.code }));
  redirect(back({ dismissed: id.data }));
}
