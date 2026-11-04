// Demo accounts for fake-auth mode (AUTH_PROVIDER=fake, never production).
// The e2e suite signs in as these. The TOTP secret is public on purpose: it
// only ever unlocks in-memory demo data.

import { FakeAuthProvider } from "./fake-provider";
import { MemoryDirectory } from "./directory";
import type { Profile, Role } from "./types";

export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export type DemoAccount = { id: string; email: string; roles: Role[]; totp: boolean; profile: Partial<Profile> };

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    email: "broker@corin.test",
    roles: ["broker"],
    totp: true,
    profile: {
      fullName: "Demo Broker",
      title: "Managing Director",
      dreLicenseNumber: "01234567",
      dreLicenseType: "broker",
      dreLicenseExpiresOn: "2029-06-30",
      dreLicenseVerifiedAt: "2026-10-01T00:00:00.000Z",
    },
  },
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    email: "analyst@corin.test",
    roles: ["analyst"],
    totp: false,
    profile: { fullName: "Demo Analyst", title: "Analyst" },
  },
  {
    id: "00000000-0000-4000-8000-0000000000ad",
    email: "admin@corin.test",
    roles: ["admin"],
    totp: true,
    profile: { fullName: "Demo Admin", title: "Operations" },
  },
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    email: "borrower@corin.test",
    roles: ["borrower"],
    totp: false,
    profile: { fullName: "Demo Borrower" },
  },
];

export function demoProfile(a: DemoAccount): Profile {
  return {
    id: a.id,
    email: a.email,
    fullName: a.profile.fullName ?? null,
    title: a.profile.title ?? null,
    active: true,
    dreLicenseNumber: a.profile.dreLicenseNumber ?? null,
    dreLicenseType: a.profile.dreLicenseType ?? null,
    dreLicenseExpiresOn: a.profile.dreLicenseExpiresOn ?? null,
    dreLicenseVerifiedAt: a.profile.dreLicenseVerifiedAt ?? null,
  };
}

export function seedDemoAccounts(provider: FakeAuthProvider, directory: MemoryDirectory): void {
  for (const a of DEMO_ACCOUNTS) {
    provider.addUser({ id: a.id, email: a.email, totpSecret: a.totp ? DEMO_TOTP_SECRET : undefined });
    directory.set(demoProfile(a), a.roles);
  }
}
