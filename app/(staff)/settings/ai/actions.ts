"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { staffForMutation } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { AI_TASK_IDS, taskModelStore } from "@/lib/ai/model-settings";
import { DEFAULT_MODEL_CHOICE, MODEL_REASON_MAX, ModelSettingError, setTaskModel, type ModelSettingErrorCode } from "@/lib/ai/model-settings-admin";

// Choose which model an AI task runs on. The action re-authenticates the
// caller and re-checks the capability (administrators only); setTaskModel
// checks again, requires a reason and accepts only models the task allows.
// Results go back as query parameters (task ids and codes, never free text).

const schema = z.object({
  task: z.enum(AI_TASK_IDS),
  model: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  reason: z.string().trim().max(MODEL_REASON_MAX),
});

const back = (params: Record<string, string>) => `/settings/ai?${new URLSearchParams(params).toString()}`;

export async function saveTaskModelAction(formData: FormData): Promise<void> {
  const auth = await staffForMutation();
  if (!auth.ok) redirect(back({ error: auth.reason === "mfa_required" ? "mfa" : "signed_out" }));
  const principal = auth.ctx.principal;
  if (!can(principal, "manage_ai_settings", californiaDate(new Date())).ok) redirect(back({ error: "forbidden" }));

  const parsed = schema.safeParse({ task: formData.get("task"), model: formData.get("model"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) redirect(back({ error: "bad_request" }));
  const { task, model, reason } = parsed.data;
  if (!reason) redirect(back({ error: "reason_required", task }));

  const store = await taskModelStore();
  if (!store) redirect(back({ error: "not_configured", task }));

  let failure: ModelSettingErrorCode | "save_failed" | null = null;
  try {
    await setTaskModel(store, { task, model: model === DEFAULT_MODEL_CHOICE ? null : model, reason }, principal);
  } catch (err) {
    if (err instanceof ModelSettingError) failure = err.code;
    else {
      console.error("[settings/ai] could not save the model choice:", err instanceof Error ? err.message : err);
      failure = "save_failed";
    }
  }
  if (failure) redirect(back({ error: failure, task }));
  redirect(back({ saved: task }));
}
