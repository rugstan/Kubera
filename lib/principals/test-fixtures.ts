// Shared fixtures for WS-U tests: a deal with a borrower LLC, an upper-tier
// managing member entity and three individuals.

import { createKeyring } from "@/lib/privacy/crypto";
import type { Principal } from "./types";

export const TEST_KEYRING = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
export const DEAL_ID = "11111111-1111-4111-8111-111111111111";

let n = 0;
export function principal(over: Partial<Principal> & Pick<Principal, "legalName">): Principal {
  n += 1;
  return {
    id: over.id ?? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    dealId: DEAL_ID,
    leadId: null,
    parentId: null,
    kind: "individual",
    roles: ["member"],
    title: null,
    ownershipPct: null,
    isGuarantor: false,
    email: null,
    phone: null,
    homeAddress: null,
    formationState: null,
    citizenship: null,
    reoSchedule: null,
    hud2530: null,
    creditAuthorization: null,
    hasSsn: false,
    hasDob: false,
    hasPfs: false,
    hasForm1919: false,
    pfsAsOf: null,
    taxIdIndex: null,
    version: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * Borrower LLC
 *   ├─ Sponsor Holdings LLC (60%, managing member)
 *   │    ├─ Ana Ruiz (50% of Sponsor → 30% effective, managing member of Sponsor)
 *   │    └─ Ben Ode  (50% of Sponsor → 30% effective)
 *   ├─ Cal Pine (25%)
 *   └─ Dee Lowe (15%)
 */
export function sampleChart() {
  const borrower = principal({ id: "aaaaaaaa-0000-4000-8000-000000000001", legalName: "Harbor View Senior Living LLC", kind: "entity", roles: ["borrower_entity"], formationState: "CA" });
  const sponsor = principal({ id: "aaaaaaaa-0000-4000-8000-000000000002", legalName: "Sponsor Holdings LLC", kind: "entity", roles: ["managing_member"], parentId: borrower.id, ownershipPct: 60 });
  const ana = principal({ id: "aaaaaaaa-0000-4000-8000-000000000003", legalName: "Ana Ruiz", roles: ["managing_member"], parentId: sponsor.id, ownershipPct: 50, email: "ana@example.com" });
  const ben = principal({ id: "aaaaaaaa-0000-4000-8000-000000000004", legalName: "Ben Ode", roles: ["member"], parentId: sponsor.id, ownershipPct: 50 });
  const cal = principal({ id: "aaaaaaaa-0000-4000-8000-000000000005", legalName: "Cal Pine", roles: ["member"], parentId: borrower.id, ownershipPct: 25 });
  const dee = principal({ id: "aaaaaaaa-0000-4000-8000-000000000006", legalName: "Dee Lowe", roles: ["member"], parentId: borrower.id, ownershipPct: 15 });
  return { borrower, sponsor, ana, ben, cal, dee, all: [borrower, sponsor, ana, ben, cal, dee] };
}
