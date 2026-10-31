import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_CUSTODY_TOKENS } from "@/lib/compliance/no-custody";
import { renderTemplateSeedSql, SEED_BEGIN, SEED_END } from "./seed";
import { CHECKLIST_TEMPLATES, checklistProgramsForSizerProgram, TEMPLATE_VERSION } from "./templates";
import { CHECKLIST_PROGRAMS, PRINCIPAL_REQUIREMENTS, type ChecklistProgram } from "./types";

const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/20261103000300_u_checklists_principals.sql");
const keys = (p: ChecklistProgram) => CHECKLIST_TEMPLATES[p].items.map((i) => i.key);

describe("checklist templates", () => {
  it("has a template for every program", () => {
    for (const p of CHECKLIST_PROGRAMS) {
      const t = CHECKLIST_TEMPLATES[p];
      expect(t.program).toBe(p);
      expect(t.version).toBe(TEMPLATE_VERSION);
      expect(t.items.length).toBeGreaterThan(10);
    }
  });

  it("uses unique snake_case keys and valid per-principal requirements", () => {
    for (const p of CHECKLIST_PROGRAMS) {
      const k = keys(p);
      expect(new Set(k).size).toBe(k.length);
      for (const item of CHECKLIST_TEMPLATES[p].items) {
        expect(item.key).toMatch(/^[a-z0-9_]+$/);
        if (item.perPrincipal) expect(PRINCIPAL_REQUIREMENTS).toContain(item.perPrincipal);
        expect(item.description.length).toBeGreaterThan(10);
      }
    }
  });

  it("never tracks funds, draws, lien releases or construction inspections (broker only)", () => {
    const words = /\b(draws?|disburse\w*|lien waivers?|lien releases?|escrow balance|trust account|funds control|draw inspection|servic(e|ing) the loan)\b/i;
    for (const p of CHECKLIST_PROGRAMS) {
      for (const item of CHECKLIST_TEMPLATES[p].items) {
        const text = `${item.key} ${item.title} ${item.description}`;
        expect(text, `${p}.${item.key}`).not.toMatch(words);
        const compact = item.key.replace(/_/g, "");
        for (const token of FORBIDDEN_CUSTODY_TOKENS) expect(compact).not.toContain(token);
      }
    }
  });

  it("covers the construction pre-closing package", () => {
    for (const p of ["CONSTRUCTION", "HUD_221D4", "HUD_232_NEW_CONSTRUCTION"] as const) {
      expect(keys(p)).toEqual(
        expect.arrayContaining(["construction_budget", "plans_specs", "building_permits", "gc_license", "construction_schedule", "plan_cost_review", "phase_i_esa", "geotech_report", "builders_risk", "title_endorsements"]),
      );
      expect(keys(p).some((k) => k.startsWith("appraisal"))).toBe(true);
      expect(keys(p)).toContain("gmp_contract");
    }
    const gc = CHECKLIST_TEMPLATES.CONSTRUCTION.items.find((i) => i.key === "gc_license")!;
    expect(gc.lookup).toBe("cslb_license");
    expect(gc.required).toBe(true);
    // Nothing in the construction checklist happens after closing.
    expect(CHECKLIST_TEMPLATES.CONSTRUCTION.items.every((i) => ["application", "underwriting", "pre_closing"].includes(i.stage))).toBe(true);
  });

  it("covers the multifamily specifics", () => {
    for (const p of ["AGENCY_MULTIFAMILY", "HUD_MULTIFAMILY_223F"] as const) {
      expect(keys(p)).toEqual(expect.arrayContaining(["rent_roll_certified", "t3", "t12", "insurance_evidence"]));
    }
    expect(keys("AGENCY_MULTIFAMILY")).toContain("seismic_pml");
    const rr = CHECKLIST_TEMPLATES.AGENCY_MULTIFAMILY.items.find((i) => i.key === "rent_roll_certified")!;
    expect(rr.recencyDays).toBeLessThanOrEqual(30);
  });

  it("asks for the program forms", () => {
    expect(keys("SBA_7A")).toEqual(expect.arrayContaining(["form_1919", "pfs", "guaranty", "tax_transcript_authorization"]));
    expect(CHECKLIST_TEMPLATES.SBA_7A.items.find((i) => i.key === "pfs")!.title).toContain("Form 413");
    expect(keys("SBA_504")).toEqual(expect.arrayContaining(["cdc_application", "owner_occupancy", "job_creation", "form_1919"]));
    for (const p of ["HUD_232_223F", "HUD_232_NEW_CONSTRUCTION", "HUD_MULTIFAMILY_223F", "HUD_221D4"] as const) {
      expect(keys(p)).toContain("hud_2530");
      // HUD loans are non-recourse: no personal guaranty item.
      expect(keys(p)).not.toContain("guaranty");
    }
    expect(keys("HUD_232_223F")).toEqual(expect.arrayContaining(["operator_agreement", "state_license", "census_payor_mix"]));
    expect(keys("HOTEL_CMBS")).toEqual(expect.arrayContaining(["str_report", "franchise_agreement", "franchise_comfort_letter"]));
    expect(keys("PIP_BRIDGE")).toEqual(expect.arrayContaining(["pip_document", "pip_budget", "gc_license"]));
    expect(keys("HARD_MONEY")).toEqual(expect.arrayContaining(["scope_of_work", "arv_support", "exit_plan", "track_record"]));
    expect(keys("BRIDGE")).toEqual(expect.arrayContaining(["business_plan_capex", "exit_plan"]));
  });

  it("maps sizer programs to checklists", () => {
    expect(checklistProgramsForSizerProgram("SBA_504_PLUS_7A_10M_STACK")).toEqual(["SBA_504", "SBA_7A"]);
    expect(checklistProgramsForSizerProgram("HUD_232_223F")).toEqual(["HUD_232_223F"]);
    expect(checklistProgramsForSizerProgram("BRIDGE_TO_HUD_232")).toEqual(["BRIDGE"]);
    expect(checklistProgramsForSizerProgram("AGENCY_FANNIE_FREDDIE")).toEqual(["AGENCY_MULTIFAMILY"]);
    expect(checklistProgramsForSizerProgram("UNKNOWN")).toEqual([]);
  });

  it("is seeded in the migration exactly as defined here", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf(SEED_BEGIN);
    const end = sql.indexOf(SEED_END);
    expect(start).toBeGreaterThan(0);
    expect(sql.slice(start, end + SEED_END.length)).toBe(renderTemplateSeedSql());
  });
});
