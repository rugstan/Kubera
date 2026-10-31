// Per-task autonomy levels.
//
//   audit     shadow mode: the agent's proposed actions are logged to
//             agent_events and nothing is requested or sent.
//   assist    the agent drafts; every side-effecting action waits for a
//             broker in the approvals queue (pre-approved templates are not
//             used, so nothing goes out without a person deciding).
//   automate  actions rendered from a broker-pre-approved template may be
//             approved by the queue automatically; everything else still waits
//             for a broker. Automate never bypasses the gate (Global rule 2).
//
// Each task has a ceiling. Sensitive actions (MLDS, Form 159, lender
// submissions, fee quotes, voice calls) are capped at assist and need step-up
// re-authentication by the approving broker. Unknown tasks run at audit.
// Changes are history rows (agent_task_autonomy) set by a licensed broker.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DRE_LICENSE_PATTERN } from "@/lib/site";

export const AUTONOMY_LEVELS = ["audit", "assist", "automate"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

const RANK: Record<AutonomyLevel, number> = { audit: 0, assist: 1, automate: 2 };

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return typeof v === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(v);
}

export function minLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export function atLeast(level: AutonomyLevel, wanted: AutonomyLevel): boolean {
  return RANK[level] >= RANK[wanted];
}

export type TaskPolicy = {
  description: string;
  /** Level used until a broker changes it. */
  defaultLevel: AutonomyLevel;
  /** Highest level a broker may set. */
  maxLevel: AutonomyLevel;
  /** Approving broker must re-authenticate (lib/agents/core/reauth.ts). */
  reauth?: boolean;
};

/**
 * Every agent task the platform knows. Owners of new agents add their tasks
 * here (or register them at runtime with `AutonomyPolicy.withTasks`).
 */
export const AGENT_TASKS = {
  "qualifier.decision": { description: "Score and route a qualifier submission (internal only; borrower sees indicative terms)", defaultLevel: "automate", maxLevel: "automate" },
  "lenders.matching": { description: "Rank lenders for a deal (internal only)", defaultLevel: "automate", maxLevel: "automate" },
  "mail.triage": { description: "Classify inbound mail and route it to a deal queue (internal only)", defaultLevel: "automate", maxLevel: "automate" },
  "documents.extraction": { description: "Extract fields from deal documents into document_extractions (internal only)", defaultLevel: "automate", maxLevel: "automate" },
  "documents.review_request": { description: "Ask a borrower for a corrected or missing document", defaultLevel: "assist", maxLevel: "automate" },
  "crm.note": { description: "Add a note to a Twenty record from an email or call", defaultLevel: "assist", maxLevel: "automate" },
  "crm.task": { description: "Create a broker task in Twenty", defaultLevel: "automate", maxLevel: "automate" },
  "crm.stage_update": { description: "Move a Twenty opportunity to another stage", defaultLevel: "assist", maxLevel: "automate" },
  "crm.owner_change": { description: "Change the owner of a Twenty record", defaultLevel: "assist", maxLevel: "assist" },
  "crm.dedupe": { description: "Merge duplicate Twenty companies or people", defaultLevel: "assist", maxLevel: "assist" },
  "outreach.lead_sms": { description: "Speed-to-lead text from a pre-approved template", defaultLevel: "assist", maxLevel: "automate" },
  "outreach.document_reminder": { description: "Checklist-driven document reminder email or text", defaultLevel: "assist", maxLevel: "automate" },
  "outreach.vendor_nudge": { description: "Nudge a third-party report vendor about an order", defaultLevel: "assist", maxLevel: "automate" },
  "outreach.closing_nudge": { description: "Pre-closing checklist nudge to the deal team", defaultLevel: "assist", maxLevel: "automate" },
  "outreach.voice_call": { description: "Outbound voice call (recording and AI-voice consent required)", defaultLevel: "assist", maxLevel: "assist" },
  "lenders.outreach": { description: "Send a deal teaser to matched lenders", defaultLevel: "assist", maxLevel: "assist" },
  "lenders.submission": { description: "Submit a loan package to a lender", defaultLevel: "assist", maxLevel: "assist", reauth: true },
  "lenders.quote_parse": { description: "Parse a lender term sheet into quotes (internal only)", defaultLevel: "automate", maxLevel: "automate" },
  "disclosures.mlds_send": { description: "Send the RE 882 Mortgage Loan Disclosure Statement for signature", defaultLevel: "assist", maxLevel: "assist", reauth: true },
  "deals.form159_send": { description: "Send SBA Form 159 for signature", defaultLevel: "assist", maxLevel: "assist", reauth: true },
  "deals.fee_quote": { description: "Send a broker fee quote or engagement terms", defaultLevel: "assist", maxLevel: "assist", reauth: true },
  "intel.market_draft": { description: "Draft the weekly market-intel note for review", defaultLevel: "assist", maxLevel: "assist" },
  "prospecting.outreach_draft": { description: "Draft refinance-maturity outreach for review", defaultLevel: "assist", maxLevel: "assist" },
} as const satisfies Record<string, TaskPolicy>;

export type KnownTask = keyof typeof AGENT_TASKS;

export const UNKNOWN_TASK_POLICY: TaskPolicy = { description: "Unregistered task", defaultLevel: "audit", maxLevel: "audit" };

export type AutonomySetting = {
  task: string;
  level: AutonomyLevel;
  setAt: string;
  setBy: string | null;
  setByLabel: string;
  setByDre: string;
  reason: string;
};

export interface AutonomyStore {
  /** Latest setting per task. */
  current(): Promise<AutonomySetting[]>;
  /** Latest setting for one task. */
  latest(task: string): Promise<AutonomySetting | null>;
  history(task: string): Promise<AutonomySetting[]>;
  append(setting: AutonomySetting): Promise<void>;
}

export class AutonomyError extends Error {
  constructor(
    readonly code: "unknown_task" | "above_ceiling" | "invalid_approver" | "reason_required",
    message: string,
  ) {
    super(message);
    this.name = "AutonomyError";
  }
}

export type Setter = { userId: string | null; label: string; dreLicense: string | null };

export class AutonomyPolicy {
  private readonly tasks: Map<string, TaskPolicy>;

  constructor(
    private readonly store: AutonomyStore,
    tasks: Record<string, TaskPolicy> = AGENT_TASKS,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tasks = new Map(Object.entries(tasks));
    for (const [task, p] of this.tasks) {
      if (!atLeast(p.maxLevel, p.defaultLevel)) throw new Error(`task ${task}: default level above its ceiling`);
      if (p.reauth && atLeast(p.maxLevel, "automate")) throw new Error(`task ${task}: re-authenticated tasks are capped at assist`);
    }
  }

  /** Same store, more tasks (for agents registered after start-up). */
  withTasks(extra: Record<string, TaskPolicy>): AutonomyPolicy {
    return new AutonomyPolicy(this.store, { ...Object.fromEntries(this.tasks), ...extra }, this.now);
  }

  policy(task: string): TaskPolicy {
    return this.tasks.get(task) ?? UNKNOWN_TASK_POLICY;
  }

  known(task: string): boolean {
    return this.tasks.has(task);
  }

  /** Effective level: the latest broker setting, clamped to the ceiling; audit for unknown tasks. */
  async level(task: string): Promise<AutonomyLevel> {
    const p = this.policy(task);
    if (!this.tasks.has(task)) return "audit";
    const setting = await this.store.latest(task);
    return minLevel(setting?.level ?? p.defaultLevel, p.maxLevel);
  }

  async levels(): Promise<Record<string, AutonomyLevel>> {
    const current = new Map((await this.store.current()).map((s) => [s.task, s.level]));
    return Object.fromEntries([...this.tasks].map(([task, p]) => [task, minLevel(current.get(task) ?? p.defaultLevel, p.maxLevel)]));
  }

  /** Records a new level for a task. Only licensed brokers; never above the task's ceiling. */
  async set(task: string, level: AutonomyLevel, by: Setter, reason: string): Promise<AutonomySetting> {
    const p = this.tasks.get(task);
    if (!p) throw new AutonomyError("unknown_task", `unknown agent task ${task}`);
    if (!atLeast(p.maxLevel, level)) throw new AutonomyError("above_ceiling", `${task} is capped at ${p.maxLevel}`);
    if (!by.dreLicense || !DRE_LICENSE_PATTERN.test(by.dreLicense)) throw new AutonomyError("invalid_approver", "a licensed broker must set autonomy levels");
    const why = reason.trim().slice(0, 1000);
    if (!why) throw new AutonomyError("reason_required", "a reason is required");
    const setting: AutonomySetting = { task, level, setAt: this.now().toISOString(), setBy: by.userId, setByLabel: by.label.slice(0, 200) || "broker", setByDre: by.dreLicense, reason: why };
    await this.store.append(setting);
    return setting;
  }
}

export class MemoryAutonomyStore implements AutonomyStore {
  readonly rows: AutonomySetting[] = [];

  async current(): Promise<AutonomySetting[]> {
    const latest = new Map<string, AutonomySetting>();
    for (const r of this.rows) latest.set(r.task, r);
    return [...latest.values()].map((r) => ({ ...r }));
  }

  async latest(task: string): Promise<AutonomySetting | null> {
    const r = this.rows.findLast((x) => x.task === task);
    return r ? { ...r } : null;
  }

  async history(task: string): Promise<AutonomySetting[]> {
    return this.rows.filter((r) => r.task === task).reverse().map((r) => ({ ...r }));
  }

  async append(setting: AutonomySetting): Promise<void> {
    this.rows.push({ ...setting });
  }
}

type Row = { task: string; level: string; set_at: string; set_by: string | null; set_by_label: string; set_by_dre: string; reason: string };

const fromRow = (r: Row): AutonomySetting | null =>
  isAutonomyLevel(r.level) ? { task: r.task, level: r.level, setAt: r.set_at, setBy: r.set_by, setByLabel: r.set_by_label, setByDre: r.set_by_dre, reason: r.reason } : null;

export function supabaseAutonomyStore(db: SupabaseClient): AutonomyStore {
  const table = () => db.from("agent_task_autonomy");
  const cols = "task, level, set_at, set_by, set_by_label, set_by_dre, reason";
  return {
    async current() {
      // Small table (one row per change); newest first, first row per task wins.
      const { data, error } = await table().select(cols).order("id", { ascending: false }).limit(2000);
      if (error) throw new Error(`agent_task_autonomy read failed: ${error.message}`);
      const latest = new Map<string, AutonomySetting>();
      for (const r of (data ?? []) as Row[]) {
        const s = fromRow(r);
        if (s && !latest.has(s.task)) latest.set(s.task, s);
      }
      return [...latest.values()];
    },
    async latest(task) {
      const { data, error } = await table().select(cols).eq("task", task).order("id", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`agent_task_autonomy read failed: ${error.message}`);
      return data ? fromRow(data as Row) : null;
    },
    async history(task) {
      const { data, error } = await table().select(cols).eq("task", task).order("id", { ascending: false }).limit(200);
      if (error) throw new Error(`agent_task_autonomy read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(fromRow).filter((s): s is AutonomySetting => s !== null);
    },
    async append(s) {
      const { error } = await table().insert({ task: s.task, level: s.level, set_at: s.setAt, set_by: s.setBy, set_by_label: s.setByLabel, set_by_dre: s.setByDre, reason: s.reason });
      if (error) throw new Error(`agent_task_autonomy insert failed: ${error.message}`);
    },
  };
}
