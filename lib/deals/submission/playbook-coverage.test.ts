// The 17 playbook ids, cross-checked (spec 8, Phase 2): the database's check
// list, submissionPlaybooks, the requirements table, the summary's headline
// choice and the lender email's variations (one golden file each) must all
// name the same 17, so adding or renaming a playbook in one place fails here
// until every other place follows.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST_PROGRAM, PLAYBOOK_LENDER_PROFILE } from "./context";
import { EMAIL_BLOCK_PLAYBOOKS, buildLenderEmail, emailLenderFrom } from "./email";
import { computeSubmissionMetrics } from "./metrics";
import { PLAYBOOK_LABELS, PLAYBOOK_SHORT_LABELS, PROGRAM_PLAYBOOKS, playbookLoanTypes, playbookTrancheSource } from "./playbooks";
import { evaluateReadiness } from "./readiness";
import { SUBMISSION_REQUIREMENTS, requirementLevel } from "./requirements";
import { submissionProfilePatchSchema } from "./schema";
import { headlineMetricKeys } from "./summary";
import { submissionFixture } from "./test-fixtures";
import { submissionPlaybooks, type SubmissionPlaybook } from "./types";
import { toPanelEntry, lenderInput } from "../test-fixtures";

const IDS = [...submissionPlaybooks].sort();
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

const SQL = readFileSync(path.resolve(import.meta.dirname, "../../../supabase/migrations/20261105160000_int_deal_submission.sql"), "utf8");
/** The values of `playbook text not null check (playbook in (...))` in deal_submission_profiles. */
function sqlPlaybooks(): string[] {
  const m = /playbook text not null check \(playbook in \(([^)]*)\)\)/.exec(SQL);
  if (!m) throw new Error("deal_submission_profiles.playbook check not found in the migration");
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!);
}

describe("the 17 playbook ids agree everywhere", () => {
  it("there are 17, unique, and the migration's check list is the same set", () => {
    expect(IDS).toHaveLength(17);
    expect(new Set(submissionPlaybooks).size).toBe(17);
    const sql = sqlPlaybooks();
    expect(sql).toHaveLength(17);
    expect(sorted(sql)).toEqual(IDS);
    // The zod schema behind every save takes exactly these.
    for (const pb of IDS) expect(submissionProfilePatchSchema.safeParse({ playbook: pb }).success, pb).toBe(true);
    expect(submissionProfilePatchSchema.safeParse({ playbook: "dscr" }).success).toBe(false);
  });

  it("every per-playbook map in the module has exactly the 17 keys", () => {
    for (const [name, map] of Object.entries({ PLAYBOOK_LABELS, PLAYBOOK_SHORT_LABELS, playbookLoanTypes, playbookTrancheSource, PLAYBOOK_LENDER_PROFILE })) {
      expect(sorted(Object.keys(map)), name).toEqual(IDS);
    }
    // Every playbook is reachable from some deal program, and programs only offer known playbooks.
    const offered = Object.values(PROGRAM_PLAYBOOKS).flatMap((p) => [p.default, ...p.also]);
    expect(sorted(offered)).toEqual(IDS);
    expect(Object.keys(DEFAULT_CHECKLIST_PROGRAM).length).toBe(Object.keys(PROGRAM_PLAYBOOKS).length);
  });

  it("the requirements table names only these ids, gives each its own items, and a core set at Screen", () => {
    const named = SUBMISSION_REQUIREMENTS.flatMap((r) => Object.keys(r.levels).filter((k) => k !== "all"));
    expect(named.filter((k) => !IDS.includes(k as SubmissionPlaybook))).toEqual([]);
    // Each playbook is named by at least one requirement of its own (its program section, its sponsor or exit rules).
    expect(sorted(named)).toEqual(IDS);
    for (const pb of IDS) {
      const atScreen = SUBMISSION_REQUIREMENTS.filter((r) => requirementLevel(r, pb, "screen") === "required").map((r) => r.id);
      expect(atScreen, pb).toEqual(expect.arrayContaining(["request.amount", "request.purpose", "property.identity", "value.basis", "sponsor.experience", "sponsor.strength"]));
      const atTermSheet = SUBMISSION_REQUIREMENTS.filter((r) => requirementLevel(r, pb, "term_sheet") === "required");
      expect(atTermSheet.length, pb).toBeGreaterThan(atScreen.length);
    }
  });

  it("each id has a fixture that the requirements table finds complete at Screen and Term sheet", () => {
    for (const pb of IDS) {
      const ctx = submissionFixture(pb);
      expect(ctx.profile?.playbook, pb).toBe(pb);
      const metrics = computeSubmissionMetrics(ctx);
      expect(evaluateReadiness(ctx, metrics, "screen").missing, `${pb} screen`).toEqual([]);
      expect(evaluateReadiness(ctx, metrics, "term_sheet").missing, `${pb} term sheet`).toEqual([]);
    }
  });

  it("the summary picks headline metrics for each id", () => {
    for (const pb of IDS) expect(headlineMetricKeys(pb).length, pb).toBeGreaterThan(0);
  });

  it("the lender email: one golden file per id, its per-playbook blocks name only these ids, and each id renders its own subject", () => {
    const golden = readdirSync(path.resolve(import.meta.dirname, "__golden__")).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
    expect(sorted(golden)).toEqual(IDS);
    for (const pb of [...EMAIL_BLOCK_PLAYBOOKS.beforeNumbers, ...EMAIL_BLOCK_PLAYBOOKS.afterNumbers]) expect(IDS, pb).toContain(pb);
    const lender = emailLenderFrom(toPanelEntry(lenderInput({ name: "Coverage Capital" }), "lender-coverage"));
    const subjects = new Set<string>();
    for (const pb of IDS) {
      const ctx = submissionFixture(pb);
      const fit = { lenderId: lender.id, matches: [], exceptions: [], unknown: [], staleness: { stale: false, ageDays: 0, reason: null }, score: null };
      const email = buildLenderEmail({ ctx, metrics: computeSubmissionMetrics(ctx), stage: "screen", lender, fit, documents: [], notYetInHand: [], advisor: { name: "Ana Ruiz", title: null, dreLicense: "01234567", email: "ana@corincommercial.com", phone: null } });
      expect(email.subject, pb).toContain(` ${PLAYBOOK_SHORT_LABELS[pb]} |`);
      subjects.add(email.subject);
    }
    expect(subjects.size).toBe(17);
  });
});
