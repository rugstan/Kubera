import "server-only";
import { createHash } from "node:crypto";
import { crmAgentDeps } from "@/lib/agents/crm/server";
import { crmStageSink } from "@/lib/agents/crm/stage-sync";
import { approvalGate } from "@/lib/approvals/server";
import { checklistDeps, deskServices } from "@/lib/checklists/server";
import type { ChecklistDeps } from "@/lib/checklists/service";
import { primaryStaffRole, signedInStaff, staffDreLicense } from "@/lib/auth/staff";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DocumentStorage, DisclosureStore } from "@/lib/disclosures/store";
import { SupabaseDisclosureStore, SupabaseDocumentStorage } from "@/lib/disclosures/store-supabase";
import { esignProvider } from "@/lib/esign";
import { emailClientFromEnv } from "@/lib/notify/email";
import { notifyRuntime } from "@/lib/notify/runtime";
import type { EsignProvider } from "@/lib/esign/types";
import { site } from "@/lib/site";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";
import type { BrokerIdentity } from "./dre";
import type { Form159Data } from "./form159";
import { emailLenderMailer } from "./mailer";
import type { LenderMailer } from "./packages";
import type { DealDeskDeps } from "./service";
import { notifierStageSink, type DealStageEventSink } from "./stage-events";
import type { StaffSession } from "./session";
import type { DealDeskStore } from "./store";
import { SupabaseDealDeskStore } from "./store-supabase";
import type { PackageItem } from "./types";

// Production wiring for the deal desk. Everything is env-gated (Global rule 3):
// without Supabase the pages render a "not configured" state; without an
// approvals queue (WS-I) approvalGate() is the closed gate and keeps every
// outbound action pending.

export type DealDeskRuntime = {
  store: DealDeskStore;
  disclosures: DisclosureStore;
  storage: DocumentStorage;
  gate: ApprovalGate;
  esign: EsignProvider | null;
  /** Outbound mail (Resend, WS-J) for approved lender submissions, lender notices and invoices; null = broker sends manually. */
  mailer: LenderMailer | null;
  baseUrl: string;
  now: () => Date;
  /** WS-U checklist / screening services: sanctions holds and the closing gate. */
  checklist: ChecklistDeps | null;
  /** Milestone notifications for stage changes (WS-J). */
  stageEvents: DealStageEventSink | null;
  vaultItems(leadId: string, documentIds: string[]): Promise<PackageItem[]>;
  vaultDocuments(leadId: string): Promise<{ id: string; kind: string; fileName: string; createdAt: string }[]>;
};

let warned = false;

export function dealDeskRuntime(): DealDeskRuntime | null {
  const db = supabaseAdmin();
  if (!db) {
    if (!warned) {
      warned = true;
      console.warn("[deals] Supabase is not configured; the deal desk is read-only and empty.");
    }
    return null;
  }
  return {
    store: new SupabaseDealDeskStore(db),
    disclosures: new SupabaseDisclosureStore(db),
    storage: new SupabaseDocumentStorage(db),
    gate: approvalGate(),
    esign: esignProvider(),
    mailer: emailLenderMailer(emailClientFromEnv()),
    baseUrl: site.siteUrl,
    now: () => new Date(),
    checklist: checklistFromDesk(),
    stageEvents: stageEventSink(),
    async vaultDocuments(leadId) {
      // Only files with a clean malware scan (WS-K vault) can go into a lender package.
      const { data, error } = await db.from("documents").select("id, kind, file_name, created_at").eq("lead_id", leadId).eq("status", "clean").order("created_at");
      if (error) throw new Error(`vault documents: ${error.message}`);
      return ((data ?? []) as { id: string; kind: string; file_name: string; created_at: string }[]).map((d) => ({ id: d.id, kind: d.kind, fileName: d.file_name, createdAt: d.created_at }));
    },
    async vaultItems(leadId, documentIds) {
      if (!documentIds.length) return [];
      const { data, error } = await db.from("documents").select("id, kind, file_name, storage_path, lead_id").eq("lead_id", leadId).eq("status", "clean").in("id", documentIds);
      if (error) throw new Error(`vault documents: ${error.message}`);
      const rows = (data ?? []) as { id: string; kind: string; file_name: string; storage_path: string }[];
      if (rows.length !== new Set(documentIds).size) throw new Error("Some documents do not belong to this deal's lead or have not passed the malware scan");
      // Hash the stored bytes so the locked manifest proves exactly what the lender received.
      return Promise.all(
        rows.map(async (r) => {
          const { data: blob, error: dlError } = await db.storage.from(DOCUMENT_BUCKET).download(r.storage_path);
          if (dlError || !blob) throw new Error(`vault download ${r.storage_path}: ${dlError?.message ?? "missing"}`);
          const sha256 = createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
          return { documentId: r.id, label: r.file_name, kind: r.kind, storagePath: r.storage_path, sha256 };
        }),
      );
    },
  };
}

function checklistFromDesk(): ChecklistDeps | null {
  const desk = deskServices();
  return desk ? checklistDeps(desk) : null;
}

/** Notifications first, then the CRM agents (when Twenty and Supabase are configured). */
function stageEventSink(): DealStageEventSink {
  const rt = notifyRuntime();
  const notifier = notifierStageSink({ notifier: rt.notifier, leads: rt.leads });
  const crm = crmAgentDeps();
  if (!crm) return notifier;
  const crmSink = crmStageSink(crm);
  return {
    async stageChanged(change) {
      try {
        await notifier.stageChanged(change);
      } finally {
        // The CRM sink logs and swallows its own failures.
        await crmSink.stageChanged(change);
      }
    },
  };
}

/** The deps advanceDeal / stageContext run on. */
export function deskDeps(rt: DealDeskRuntime): DealDeskDeps {
  return { store: rt.store, disclosures: rt.disclosures, now: rt.now, checklist: rt.checklist, stageEvents: rt.stageEvents };
}

/**
 * The signed-in staff member (null = sign-in required). WS-I's lib/auth session
 * (active profile, staff role, MFA at aal2) is the only way in; without lib/auth
 * configured every deal-desk page and action fails closed. A DRE broker-officer
 * license on the profile makes the person the designated officer for gate-H
 * approvals.
 */
export async function currentStaff(): Promise<StaffSession | null> {
  const principal = await signedInStaff();
  if (!principal) return null;
  return {
    userId: principal.userId,
    email: principal.email.toLowerCase(),
    name: principal.displayName,
    role: primaryStaffRole(principal),
    dreLicense: staffDreLicense(principal),
    designatedOfficer: principal.profile.dreLicenseType === "broker_officer",
    actor: `staff:${principal.email.toLowerCase()}`,
  };
}

/** Kubera as Form 159 agent and DRE reporting broker, from configuration. */
export function kuberaAgent(staff: StaffSession): Form159Data["agent"] {
  return {
    legalName: site.legalName,
    agentType: "BROKER",
    address: (process.env.DRE_LICENSED_ADDRESS ?? "").trim() || site.licensedAddress,
    dreLicense: site.dreCorporateLicense,
    signer: { name: staff.name, email: staff.email, ...(staff.dreLicense ? { dreLicense: staff.dreLicense } : {}) },
  };
}

export function brokerIdentity(): BrokerIdentity {
  return {
    legalName: site.legalName,
    dreLicense: site.dreCorporateLicense,
    address: (process.env.DRE_LICENSED_ADDRESS ?? "").trim() || site.licensedAddress,
    designatedOfficer: site.designatedOfficer,
    officerLicense: site.dreOfficerLicense,
  };
}

/** Form 159 e-sign template for the configured provider. */
export function form159TemplateId(provider: EsignProvider | null): string | null {
  if (!provider) return null;
  if (provider.name === "fake") return "fake_sba159_template";
  const id = provider.name === "zoho_sign" ? process.env.ZOHO_SIGN_SBA159_TEMPLATE_ID : process.env.BOLDSIGN_SBA159_TEMPLATE_ID;
  return id || null;
}

export async function renderPdf(doc: Parameters<typeof import("@/lib/disclosures/pdf").renderDisclosurePdf>[0]): Promise<Uint8Array> {
  const { renderDisclosurePdf } = await import("@/lib/disclosures/pdf");
  return renderDisclosurePdf(doc);
}
