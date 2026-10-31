// Autonomy and approval policy for CRM writes (Global rule 2).
//
//   audit     log what the agent would do; nothing is requested or written
//   assist    every write waits for a broker's approval
//   automate  additive internal records (notes, tasks) are written directly and
//             logged; everything visible or destructive still waits for a broker
//
// Visible or destructive changes (stage, owner, company merge) never skip the
// gate, whatever the autonomy level: only a broker (or a pre-approved
// template, which these changes never use) lets them through. Notes and tasks
// are additive, internal and never leave Twenty: they send nothing to a
// borrower, lender or other third party, and each is logged with its source.
// Set the level to "assist" to put those through the gate as well.

import type { AutonomyLevel } from "./events";
import { CRM_TASKS, type CrmTask } from "./scopes";

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ["audit", "assist", "automate"];

export type OperationType = "stage_update" | "owner_assign" | "note_create" | "task_create" | "company_merge";

/** Operation types that change something visible to the team, or cannot be undone with a click. */
export const ALWAYS_APPROVED: ReadonlySet<OperationType> = new Set(["stage_update", "owner_assign", "company_merge"]);

export type Disposition = "log_only" | "direct" | "needs_approval";

export function dispositionFor(op: OperationType, level: AutonomyLevel): Disposition {
  if (level === "audit") return "log_only";
  if (ALWAYS_APPROVED.has(op)) return "needs_approval";
  return level === "automate" ? "direct" : "needs_approval";
}

export type AutonomyConfig = { default: AutonomyLevel; tasks: Partial<Record<CrmTask, AutonomyLevel>> };

export const DEFAULT_AUTONOMY: AutonomyConfig = { default: "automate", tasks: {} };

export function autonomyFor(config: AutonomyConfig, task: CrmTask): AutonomyLevel {
  return config.tasks[task] ?? config.default;
}

/**
 * Parses CRM_AGENT_AUTONOMY: a level ("assist") or a list of overrides
 * ("automate,dedupe=audit,stage_sync=assist"). Unknown words are ignored and
 * logged; an empty value is the default.
 */
export function parseAutonomy(raw: string | undefined | null): AutonomyConfig {
  const config: AutonomyConfig = { default: DEFAULT_AUTONOMY.default, tasks: {} };
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [left, right] = part.split("=").map((s) => s.trim());
    if (right === undefined) {
      if (AUTONOMY_LEVELS.includes(left as AutonomyLevel)) config.default = left as AutonomyLevel;
      else console.warn(`[crm-agent] ignoring unknown autonomy level "${left}"`);
      continue;
    }
    if ((CRM_TASKS as readonly string[]).includes(left!) && AUTONOMY_LEVELS.includes(right as AutonomyLevel)) config.tasks[left as CrmTask] = right as AutonomyLevel;
    else console.warn(`[crm-agent] ignoring unknown autonomy override "${part}"`);
  }
  return config;
}
