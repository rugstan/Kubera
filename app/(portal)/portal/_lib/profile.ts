// Saves one section of a principal's portal profile. Restricted values (tax
// id, birth date, PFS, Form 1919 answers) are sealed by lib/principals before
// they reach the store; nothing restricted is ever echoed back.

import { z } from "zod";
import type { DeskServices } from "@/lib/checklists/desk";
import { checklistDeps, principalDeps } from "@/lib/checklists/desk";
import { ChecklistError, markCapturedInPortal } from "@/lib/checklists/service";
import { CURRENT_CREDIT_AUTH } from "@/lib/principals/consent";
import type { PortalSession } from "@/lib/principals/portal";
import { recordCreditAuthorization, toPublicPrincipal, updatePrincipal } from "@/lib/principals/service";
import { CITIZENSHIP, form1919Schema, hud2530Schema, pfsSchema, reoScheduleSchema, taxIdSchema, type Principal } from "@/lib/principals/types";

const dob = z.iso.date({ message: "Enter your date of birth." });

export const profileRequestSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("contact"), version: z.number().int().positive(), data: z.object({ phone: z.string().trim().max(40).nullable(), homeAddress: z.string().trim().min(5, "Enter your home address.").max(300), citizenship: z.enum(CITIZENSHIP) }) }),
  z.object({ section: z.literal("identity"), version: z.number().int().positive(), data: z.object({ ssn: taxIdSchema, dob }) }),
  z.object({ section: z.literal("pfs"), version: z.number().int().positive(), data: pfsSchema }),
  z.object({ section: z.literal("reo"), version: z.number().int().positive(), data: z.object({ entries: reoScheduleSchema }) }),
  z.object({ section: z.literal("hud2530"), version: z.number().int().positive(), data: hud2530Schema }),
  z.object({ section: z.literal("form1919"), version: z.number().int().positive(), data: form1919Schema }),
  z.object({ section: z.literal("credit_authorization"), version: z.number().int().positive(), data: z.object({ signatureName: z.string().trim().min(3).max(200), textVersion: z.literal(CURRENT_CREDIT_AUTH), agree: z.literal(true, { message: "Check the box to sign the authorization." }) }) }),
]);
export type ProfileRequest = z.infer<typeof profileRequestSchema>;

const CAPTURED: Record<ProfileRequest["section"], string[]> = {
  contact: [],
  identity: [],
  pfs: ["pfs"],
  reo: ["reo_schedule"],
  hud2530: ["hud_2530"],
  form1919: ["form_1919"],
  credit_authorization: ["credit_authorization"],
};

/** What the portal shows about the principal: presence flags only for restricted data. */
export function portalPrincipalView(p: Principal) {
  return {
    id: p.id,
    legalName: p.legalName,
    kind: p.kind,
    email: p.email,
    phone: p.phone,
    homeAddress: p.homeAddress,
    citizenship: p.citizenship,
    hasSsn: p.hasSsn,
    hasDob: p.hasDob,
    hasPfs: p.hasPfs,
    pfsAsOf: p.pfsAsOf,
    hasForm1919: p.hasForm1919,
    reoSchedule: p.reoSchedule ?? [],
    hud2530: p.hud2530,
    creditAuthorizedAt: p.creditAuthorization?.consentedAt ?? null,
    version: p.version,
  };
}
export type PortalPrincipalView = ReturnType<typeof portalPrincipalView>;

export async function saveProfileSection(services: DeskServices, session: PortalSession, req: ProfileRequest, meta: { ip: string | null; userAgent: string | null }): Promise<PortalPrincipalView> {
  if (!session.principalId) throw new ChecklistError("This link is for the deal's documents. Ask your advisor for a link in your own name to complete your profile.", 403);
  const row = await services.principals.get(session.principalId);
  if (!row || row.dealId !== session.dealId) throw new ChecklistError("We could not find your profile on this deal.", 404);
  if (row.kind !== "individual") throw new ChecklistError("Profiles are completed by individuals.", 403);
  const deps = principalDeps(services);
  let saved: Principal;
  switch (req.section) {
    case "contact":
      saved = await updatePrincipal(deps, row.id, req.version, { phone: req.data.phone, homeAddress: req.data.homeAddress, citizenship: req.data.citizenship });
      break;
    case "identity":
      saved = await updatePrincipal(deps, row.id, req.version, {}, { ssn: req.data.ssn, dob: req.data.dob });
      break;
    case "pfs":
      saved = await updatePrincipal(deps, row.id, req.version, {}, { pfs: req.data });
      break;
    case "reo":
      saved = await updatePrincipal(deps, row.id, req.version, { reoSchedule: req.data.entries });
      break;
    case "hud2530":
      saved = await updatePrincipal(deps, row.id, req.version, { hud2530: req.data });
      break;
    case "form1919":
      saved = await updatePrincipal(deps, row.id, req.version, {}, { form1919: req.data });
      break;
    case "credit_authorization":
      saved = await recordCreditAuthorization(deps, row.id, req.version, { signatureName: req.data.signatureName, textVersion: req.data.textVersion, ip: meta.ip, userAgent: meta.userAgent });
      break;
  }
  if (CAPTURED[req.section].length) await markCapturedInPortal(checklistDeps(services), session.dealId, row.id, CAPTURED[req.section]);
  return portalPrincipalView(saved);
}

export async function loadPortalPrincipal(services: DeskServices, session: PortalSession): Promise<PortalPrincipalView | null> {
  if (!session.principalId) return null;
  const row = await services.principals.get(session.principalId);
  if (!row || row.dealId !== session.dealId) return null;
  return portalPrincipalView(toPublicPrincipal(row));
}
