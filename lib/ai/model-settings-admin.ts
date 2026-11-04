// Changing which model an AI task runs on (/settings/ai). Administrators only,
// always with a reason, and only to a model the task allows (approved list,
// call path and routing guard; lib/ai/model-settings.ts). Each change is a new
// history row; nothing is ever edited or deleted. Kept apart from the resolver
// so the call sites never import the auth policy.

import { californiaDate, can } from "@/lib/auth/policy";
import type { StaffPrincipal } from "@/lib/auth/types";
import { effectiveTaskModel, isAiTaskId, modelRefusal, resetTaskModelCache, type TaskModelSetting, type TaskModelStore } from "./model-settings";

type Env = Record<string, string | undefined>;

/** Longest reason the form accepts (the table allows 1000). */
export const MODEL_REASON_MAX = 500;

/** The settings form's value for "use the task's default" (stored as a null model). */
export const DEFAULT_MODEL_CHOICE = "default";

export type ModelSettingErrorCode = "forbidden" | "unknown_task" | "reason_required" | "model_not_allowed" | "no_change";

export class ModelSettingError extends Error {
  constructor(
    readonly code: ModelSettingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelSettingError";
  }
}

export type ModelChange = {
  task: string;
  /** A model id, or null to go back to the task's default. */
  model: string | null;
  reason: string;
};

/** Records a new model choice for a task and returns it. Throws ModelSettingError when the change is not allowed. */
export async function setTaskModel(store: TaskModelStore, change: ModelChange, by: StaffPrincipal, opts: { now?: Date; env?: Env } = {}): Promise<TaskModelSetting> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const allowed = can(by, "manage_ai_settings", californiaDate(now));
  if (!allowed.ok) throw new ModelSettingError("forbidden", allowed.reason);
  if (!isAiTaskId(change.task)) throw new ModelSettingError("unknown_task", `unknown AI task ${change.task}`);
  const reason = change.reason.trim().slice(0, 1000);
  if (!reason) throw new ModelSettingError("reason_required", "a reason is required");
  const model = change.model?.trim() || null;
  if (model) {
    const refusal = modelRefusal(change.task, model, env);
    if (refusal) throw new ModelSettingError("model_not_allowed", `${model} is not allowed for ${change.task} (${refusal.code})`);
  }
  const latest = (await store.history(change.task, 1))[0] ?? null;
  if ((latest?.model ?? null) === model) throw new ModelSettingError("no_change", "that is already the setting for this task");

  const setting: TaskModelSetting = {
    task: change.task,
    model,
    previousModel: effectiveTaskModel(change.task, latest, env).model,
    setAt: now.toISOString(),
    setBy: by.userId,
    setByLabel: (by.displayName || by.email).slice(0, 200),
    reason,
  };
  await store.append(setting);
  // This process picks the change up on the next call; other instances within the cache period.
  resetTaskModelCache();
  return setting;
}
