import "server-only";
import { cookies } from "next/headers";
import { resolveStaff, type StaffIdentity } from "@/lib/checklists/staff";

/** The signed-in staff member for this request, or null. Call inside a Suspense boundary or a server action. */
export async function currentStaff(): Promise<StaffIdentity | null> {
  const jar = await cookies();
  return resolveStaff((name) => jar.get(name)?.value);
}

export class StaffAuthError extends Error {
  constructor() {
    super("Sign in to the deal desk first.");
    this.name = "StaffAuthError";
  }
}

export async function requireStaff(): Promise<StaffIdentity> {
  const staff = await currentStaff();
  if (!staff) throw new StaffAuthError();
  return staff;
}
