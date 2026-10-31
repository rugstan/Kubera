// Profiles and role grants. Supabase implementation reads with the service
// role (server only); the in-memory one backs tests and fake-auth mode.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole, type DreLicenseType, type Profile, type Role } from "./types";

export interface Directory {
  load(userId: string): Promise<{ profile: Profile | null; roles: Role[] }>;
  recordSignIn(userId: string, at: Date): Promise<void>;
  /** Profiles for display (deal owners, approvers). Unknown ids are omitted. */
  profiles(ids: string[]): Promise<Map<string, Profile>>;
}

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  active: boolean;
  dre_license_number: string | null;
  dre_license_type: string | null;
  dre_license_expires_on: string | null;
  dre_license_verified_at: string | null;
};

const PROFILE_COLUMNS = "id, email, full_name, title, active, dre_license_number, dre_license_type, dre_license_expires_on, dre_license_verified_at";

export function profileFromRow(r: ProfileRow): Profile {
  const type = r.dre_license_type;
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    title: r.title,
    active: r.active,
    dreLicenseNumber: r.dre_license_number,
    dreLicenseType: type === "broker" || type === "salesperson" || type === "broker_officer" ? (type as DreLicenseType) : null,
    dreLicenseExpiresOn: r.dre_license_expires_on,
    dreLicenseVerifiedAt: r.dre_license_verified_at,
  };
}

export function supabaseDirectory(db: SupabaseClient): Directory {
  return {
    async load(userId) {
      const [p, r] = await Promise.all([
        db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle<ProfileRow>(),
        db.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (p.error) throw new Error(`profiles lookup failed: ${p.error.message}`);
      if (r.error) throw new Error(`user_roles lookup failed: ${r.error.message}`);
      const roles = ((r.data ?? []) as { role: unknown }[]).map((x) => x.role).filter(isRole);
      return { profile: p.data ? profileFromRow(p.data) : null, roles };
    },
    async recordSignIn(userId, at) {
      const { error } = await db.from("profiles").update({ last_sign_in_at: at.toISOString() }).eq("id", userId);
      if (error) console.error("[auth] could not record sign-in time:", error.message);
    },
    async profiles(ids) {
      const unique = [...new Set(ids)].filter(Boolean);
      const out = new Map<string, Profile>();
      if (unique.length === 0) return out;
      const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).in("id", unique);
      if (error) throw new Error(`profiles lookup failed: ${error.message}`);
      for (const row of (data ?? []) as ProfileRow[]) out.set(row.id, profileFromRow(row));
      return out;
    },
  };
}

export class MemoryDirectory implements Directory {
  readonly signIns: { userId: string; at: Date }[] = [];
  private readonly entries = new Map<string, { profile: Profile; roles: Role[] }>();

  set(profile: Profile, roles: Role[]): void {
    this.entries.set(profile.id, { profile, roles });
  }

  async load(userId: string) {
    const e = this.entries.get(userId);
    return e ? { profile: { ...e.profile }, roles: [...e.roles] } : { profile: null, roles: [] };
  }

  async recordSignIn(userId: string, at: Date) {
    this.signIns.push({ userId, at });
  }

  async profiles(ids: string[]) {
    const out = new Map<string, Profile>();
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e) out.set(id, { ...e.profile });
    }
    return out;
  }
}
