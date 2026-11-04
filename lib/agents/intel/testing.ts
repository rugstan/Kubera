// Fixtures and fakes shared by the WS-S tests.

import { MemoryAgentEventStore } from "@/lib/agents/core/events";
import { createGateway, type ModelGateway } from "@/lib/ai/gateway";
import { FakeModelProvider } from "@/lib/ai/gateway/fake";
import type { ModelProvider } from "@/lib/ai/routing";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { Approver } from "@/lib/approvals/types";
import { FakeEmailClient } from "@/lib/notify/email/fake";
import { MemoryIntelStore } from "./intel-store";
import { MemoryProspectStore } from "./prospect-store";
import type { OutreachDeps, SenderIdentity } from "./outreach";
import { toScanned } from "./prospects";
import type { MaturityRecord, Prospect } from "./types";

export const NOW = new Date("2026-11-05T17:00:00.000Z");

export const broker: Approver = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

export const identity: SenderIdentity = {
  legalName: "Corin Commercial, Inc.",
  signOff: "Neeli Khanna, Corin Commercial",
  licenseLine: "Corin Commercial, Inc. · Real estate broker, California Department of Real Estate · CA DRE Corp. License #01000000",
  address: "1 Licensed Way, Los Angeles, CA 90001",
  phone: "(310) 555-0100",
  replyEmail: "deals@corincommercial.com",
  optOutEmail: "privacy@corincommercial.com",
};

export function plusMonths(months: number, from: Date = NOW): string {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function maturityRecord(over: Partial<Omit<MaturityRecord, "loan" | "address">> & { loan?: Partial<MaturityRecord["loan"]>; address?: Partial<MaturityRecord["address"]> } = {}): MaturityRecord {
  const { loan, address, ...rest } = over;
  return {
    source: "fake",
    sourceRef: "ref-1",
    address: { line1: "100 Example Ave", city: "Los Angeles", state: "CA", zip: "90001", ...address },
    apn: "0000-000-001",
    propertyType: "multifamily",
    units: 48,
    buildingSqft: 41_000,
    yearBuilt: 1978,
    ownerName: "Example Court Partners LLC",
    ownerKind: "entity",
    mailing: { line1: "200 Sample Plaza", city: "Pasadena", state: "CA", zip: "91101" },
    loan: { lender: "Sample Community Bank", originalAmount: 7_400_000, originationDate: plusMonths(-112), maturityDate: plusMonths(8), ratePct: 4.1, loanType: "Fixed", ...loan },
    lastSaleDate: plusMonths(-113),
    lastSalePrice: 11_200_000,
    dataAsOf: "2026-11-05",
    ...rest,
  };
}

/** A prospect stored through the same code a scan uses. */
export async function seedProspect(store: MemoryProspectStore, over: Parameters<typeof maturityRecord>[0] = {}, staff: { contactEmail?: string | null; contactName?: string | null } = {}): Promise<Prospect> {
  const scanned = toScanned(maturityRecord(over), null, { now: NOW, marketRatePct: 6.25 });
  const { prospect } = await store.upsertScanned(scanned, "new", NOW);
  if (staff.contactEmail !== undefined || staff.contactName !== undefined) {
    return (await store.updateStaff(prospect.id, { contactEmail: staff.contactEmail ?? null, contactName: staff.contactName ?? null }, "staff:test", NOW))!;
  }
  return prospect;
}

export type TestGateway = { gateway: ModelGateway; xai: FakeModelProvider; claude: FakeModelProvider };

export function testGateway(opts: { xai?: boolean; claude?: boolean } = {}): TestGateway {
  const xai = new FakeModelProvider("xai", { text: "{}" }, opts.xai ?? true);
  const claude = new FakeModelProvider("anthropic", { text: "" }, opts.claude ?? true);
  const nvidia = new FakeModelProvider("nvidia", { text: "" }, false);
  const providers: Record<ModelProvider, FakeModelProvider> = { xai, anthropic: claude, nvidia };
  return { gateway: createGateway({ providers, now: () => NOW.getTime() }), xai, claude };
}

export function outreachSetup(opts: { email?: boolean; ttlMinutes?: number } = {}) {
  let now = NOW;
  const approvalStore = new MemoryApprovalStore();
  const approvals = new ApprovalService(approvalStore, () => now);
  const gate = queueApprovalGate(approvals, { ttlMinutes: opts.ttlMinutes ?? 60 });
  const store = new MemoryProspectStore();
  const events = new MemoryAgentEventStore(() => now);
  const email = opts.email === false ? null : new FakeEmailClient();
  const deps: OutreachDeps = { store, gate, email, consent: null, gateway: null, events, autonomy: null, identity, now: () => now };
  return { deps, store, approvals, approvalStore, events, email, advance: (ms: number) => (now = new Date(now.getTime() + ms)), clock: () => now };
}

export function intelSetup() {
  return { store: new MemoryIntelStore(), events: new MemoryAgentEventStore(() => NOW) };
}
