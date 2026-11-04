// Principal operations shared by the staff desk and the borrower portal.
// Restricted values are sealed here, before the store sees them, and only
// opened again for an explicit purpose (screening, the staff detail view).

import { randomUUID } from "node:crypto";
import type { PiiKeyring } from "@/lib/privacy/crypto";
import { buildCreditAuthorization, signatureMatches } from "./consent";
import { sealPrincipalSecrets } from "./crypto-fields";
import type { PrincipalStore } from "./store";
import { hud2530Schema, principalInputSchema, reoScheduleSchema, type CreditAuthorization, type Hud2530, type Principal, type PrincipalInput, type PrincipalRow, type PrincipalSecrets, type ReoEntry } from "./types";

export type PrincipalDeps = { principals: PrincipalStore; keyring?: PiiKeyring | null; now?: () => Date };

export class PrincipalInputError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "PrincipalInputError";
  }
}

/** The row without its sealed columns: safe to render and to log. */
export function toPublicPrincipal(row: PrincipalRow): Principal {
  const { ssnEnc, dobEnc, pfsEnc, form1919Enc, ...rest } = row;
  return rest;
}

function parseInput(input: PrincipalInput) {
  const parsed = principalInputSchema.safeParse(input);
  if (!parsed.success) throw new PrincipalInputError("Check the principal details.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return parsed.data;
}

export type AddPrincipalResult = { principal: Principal; duplicates: { id: string; dealId: string; legalName: string }[] };

export async function addPrincipal(deps: PrincipalDeps, input: PrincipalInput, secrets: PrincipalSecrets = {}): Promise<AddPrincipalResult> {
  const now = deps.now?.() ?? new Date();
  const data = parseInput(input);
  if (data.kind === "entity" && (secrets.ssn || secrets.dob || secrets.pfs || secrets.form1919)) throw new PrincipalInputError("Tax id, birth date and personal financial statements apply to individuals only.");
  const existing = await deps.principals.forDeal(data.dealId);
  if (data.roles.includes("borrower_entity") && existing.some((p) => p.roles.includes("borrower_entity"))) throw new PrincipalInputError("This deal already has a borrowing entity.");
  if (data.parentId) {
    const parent = existing.find((p) => p.id === data.parentId);
    if (!parent) throw new PrincipalInputError("The parent entity is not on this deal.");
    if (parent.kind !== "entity") throw new PrincipalInputError("Only an entity can have owners.");
  }
  const id = randomUUID();
  const sealed = sealPrincipalSecrets(id, secrets, { keyring: deps.keyring, now });
  const row = await deps.principals.insert(
    {
      id,
      dealId: data.dealId,
      leadId: data.leadId ?? null,
      parentId: data.parentId ?? null,
      kind: data.kind,
      legalName: data.legalName,
      roles: [...new Set(data.roles)],
      title: data.title ?? null,
      ownershipPct: data.roles.includes("borrower_entity") ? null : (data.ownershipPct ?? null),
      isGuarantor: data.isGuarantor,
      email: data.email?.toLowerCase() ?? null,
      phone: data.phone ?? null,
      homeAddress: data.homeAddress ?? null,
      formationState: data.formationState ?? null,
      citizenship: data.citizenship ?? null,
      reoSchedule: null,
      hud2530: null,
      creditAuthorization: null,
      hasSsn: false,
      hasDob: false,
      hasPfs: false,
      hasForm1919: false,
      pfsAsOf: null,
      taxIdIndex: null,
      ssnEnc: null,
      dobEnc: null,
      pfsEnc: null,
      form1919Enc: null,
      ...sealed,
    },
    now,
  );
  const duplicates = row.taxIdIndex ? (await deps.principals.findByTaxIdIndex(row.taxIdIndex)).filter((d) => d.id !== row.id) : [];
  return { principal: toPublicPrincipal(row), duplicates };
}

export type PrincipalPatch = Partial<Pick<Principal, "legalName" | "roles" | "title" | "ownershipPct" | "isGuarantor" | "email" | "phone" | "homeAddress" | "formationState" | "citizenship" | "parentId">> & {
  reoSchedule?: ReoEntry[] | null;
  hud2530?: Hud2530 | null;
  creditAuthorization?: CreditAuthorization | null;
};

export async function updatePrincipal(deps: PrincipalDeps, id: string, expectedVersion: number, patch: PrincipalPatch, secrets: PrincipalSecrets = {}): Promise<Principal> {
  const now = deps.now?.() ?? new Date();
  const cur = await deps.principals.get(id);
  if (!cur) throw new PrincipalInputError("Principal not found.");
  const merged = { ...toPublicPrincipal(cur), ...patch };
  parseInput({ dealId: merged.dealId, leadId: merged.leadId, parentId: merged.parentId, kind: merged.kind, legalName: merged.legalName, roles: merged.roles, title: merged.title, ownershipPct: merged.ownershipPct, isGuarantor: merged.isGuarantor, email: merged.email, phone: merged.phone, homeAddress: merged.homeAddress, formationState: merged.formationState, citizenship: merged.citizenship });
  if (cur.kind === "entity" && (secrets.ssn || secrets.dob || secrets.pfs || secrets.form1919)) throw new PrincipalInputError("Tax id, birth date and personal financial statements apply to individuals only.");
  if (patch.parentId !== undefined && patch.parentId !== cur.parentId) {
    // Moving a principal under one of its own descendants would loop the chart.
    const all = await deps.principals.forDeal(cur.dealId);
    let cursor = patch.parentId;
    while (cursor) {
      if (cursor === id) throw new PrincipalInputError("A principal cannot own itself through another entity.");
      cursor = all.find((p) => p.id === cursor)?.parentId ?? null;
    }
  }
  const reo = patch.reoSchedule === undefined ? undefined : patch.reoSchedule === null ? null : reoScheduleSchema.parse(patch.reoSchedule);
  const hud = patch.hud2530 === undefined ? undefined : patch.hud2530 === null ? null : hud2530Schema.parse(patch.hud2530);
  const sealed = sealPrincipalSecrets(id, secrets, { keyring: deps.keyring, now });
  const row = await deps.principals.update(
    id,
    expectedVersion,
    {
      ...patch,
      ...(patch.email !== undefined ? { email: patch.email?.toLowerCase() ?? null } : {}),
      ...(reo !== undefined ? { reoSchedule: reo } : {}),
      ...(hud !== undefined ? { hud2530: hud } : {}),
      ...sealed,
    },
    now,
  );
  return toPublicPrincipal(row);
}

/** Records the credit authorization the principal signed in the portal. */
export async function recordCreditAuthorization(deps: PrincipalDeps, id: string, expectedVersion: number, input: { signatureName: string; textVersion?: string; ip?: string | null; userAgent?: string | null }): Promise<Principal> {
  const cur = await deps.principals.get(id);
  if (!cur) throw new PrincipalInputError("Principal not found.");
  if (cur.kind !== "individual") throw new PrincipalInputError("Only individuals sign the credit authorization.");
  if (!signatureMatches(input.signatureName, cur.legalName)) throw new PrincipalInputError("Type your full legal name as it appears on file to sign.", [{ path: "signatureName", message: "Type your full legal name to sign." }]);
  const auth = buildCreditAuthorization({ ...input, capturedVia: "portal", now: deps.now?.() ?? new Date() });
  return updatePrincipal(deps, id, expectedVersion, { creditAuthorization: auth });
}

export async function removePrincipal(deps: PrincipalDeps, id: string): Promise<void> {
  await deps.principals.remove(id);
}
