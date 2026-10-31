"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ConstructionError, type ConstructionDeps } from "@/lib/construction/deps";
import { phaseSchema } from "@/lib/construction/schemas";
import { getConstructionDeps, requireStaff } from "@/lib/construction/server";
import * as desk from "@/lib/construction/service";
import { REPORT_TYPES, type ReportStatus } from "@/lib/construction/types";
import { type ActionState } from "./state";

// Server actions for the construction desk. Each one checks staff access
// first, validates in the service layer and returns a message for the form.
// Outbound steps (ordering a report from a vendor) go through the broker
// approval gate inside the service; nothing here sends anything directly.

type Fields = Record<string, FormDataEntryValue>;

const text = (fields: Fields, key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

async function run(formData: FormData, projectId: string | null, op: (deps: ConstructionDeps, actor: string, fields: Fields) => Promise<string>): Promise<ActionState> {
  try {
    const staff = await requireStaff();
    const deps = getConstructionDeps();
    if (!deps) throw new ConstructionError("unavailable", "The construction desk has no database configured");
    const message = await op(deps, staff.email, Object.fromEntries(formData));
    if (projectId) revalidatePath("/construction/project");
    revalidatePath("/construction");
    return { ok: true, message, fieldErrors: {}, values: {} };
  } catch (err) {
    const values = echo(formData);
    if (err instanceof ConstructionError) return { ok: false, message: err.message, fieldErrors: err.fieldErrors ?? {}, values };
    console.error("[construction] action failed", err);
    return { ok: false, message: "Something went wrong. Nothing was changed; try again.", fieldErrors: {}, values };
  }
}

export async function createProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const created: { id?: string } = {};
  const state = await run(formData, null, async (deps, actor, fields) => {
    created.id = (await desk.createProject(deps, actor, fields)).id;
    return "Project created";
  });
  if (state.ok && created.id) redirect(`/construction/project?id=${created.id}`);
  return state;
}

export async function addReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const type = text(f, "reportType");
    if (!(REPORT_TYPES as readonly string[]).includes(type)) throw new ConstructionError("validation", "Choose a report type", { reportType: "Choose a report type" });
    await desk.addReport(deps, actor, projectId, type as (typeof REPORT_TYPES)[number]);
    return "Report added to the tracker";
  });
}

export async function orderReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const report = await desk.requestReportOrder(deps, actor, text(f, "reportId"), f);
    return report.status === "ordered"
      ? "Order approved and recorded"
      : report.status === "order_blocked"
        ? "The broker did not approve this order. You can request it again."
        : "Order sent to the broker approval queue. It is not placed until a broker approves it.";
  });
}

export async function reconcileOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const report = await desk.reconcileReportOrder(deps, actor, text(f, "reportId"));
    return report.status === "ordered" ? "Approved: the order is recorded" : report.status === "order_blocked" ? "The order was not approved" : "Still waiting for a broker";
  });
}

export async function reportStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const report = await desk.setReportStatus(deps, actor, text(f, "reportId"), text(f, "to") as ReportStatus, f);
    return `Report marked ${report.status.replaceAll("_", " ")}`;
  });
}

export async function licenseCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const check = await desk.runLicenseCheck(deps, actor, projectId, text(f, "licenseNumber"));
    return check.status === "clear"
      ? "License is clear"
      : check.status === "issues"
        ? "License checked: issues found"
        : check.status === "not_found"
          ? "CSLB has no record of that license number"
          : "The CSLB lookup is not available. Verify the license at cslb.ca.gov and record it in the notes.";
  });
}

export async function conversionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    await desk.updateConversion(deps, actor, projectId, f);
    return "Conversion details saved";
  });
}

export async function leaseUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    await desk.addLeaseUpSnapshot(deps, actor, projectId, f);
    return "Lease-up snapshot saved";
  });
}

export async function takeoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    switch (text(f, "intent")) {
      case "evaluate": {
        const view = await desk.evaluateProjectTakeout(deps, actor, projectId);
        return view.takeout ? "Take-out trigger recorded" : "Not ready for a take-out yet";
      }
      case "manual": {
        const view = await desk.evaluateProjectTakeout(deps, actor, projectId, { manual: true });
        if (!view.takeout) throw new ConstructionError("conflict", "A take-out cannot be started for this project (HUD loans convert in place, and closing must happen first)");
        return "Take-out started by staff";
      }
      case "dismiss":
        await desk.dismissTakeout(deps, actor, projectId);
        return "Take-out trigger dismissed";
      case "create_deal":
        await desk.createTakeoutDeal(deps, actor, projectId);
        return "Refinance deal opened. Lender outreach still goes through the approval queue.";
      default:
        throw new ConstructionError("validation", "Unknown take-out action");
    }
  });
}

export async function phaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = text(Object.fromEntries(formData), "projectId");
  return run(formData, projectId, async (deps, actor, f) => {
    const parsed = phaseSchema.safeParse(text(f, "phase"));
    if (!parsed.success) throw new ConstructionError("validation", "Choose a phase", { phase: "Choose a phase" });
    await desk.setProjectPhase(deps, actor, projectId, parsed.data);
    return "Phase updated";
  });
}
