import { connection } from "next/server";
import type { ReactNode } from "react";
import type { ConstructionDeps } from "@/lib/construction/deps";
import { currentStaff, getConstructionDeps } from "@/lib/construction/server";
import type { StaffIdentity } from "@/lib/construction/types";
import { Notice } from "./ui";

/**
 * Runs `render` for signed-in staff with the desk's collaborators, or shows why
 * the desk cannot be used. Reads request-time data, so it must sit inside a
 * Suspense boundary (Next 16 Cache Components).
 */
export async function Desk({ render }: { render: (ctx: { deps: ConstructionDeps; staff: StaffIdentity }) => Promise<ReactNode> }) {
  await connection();
  const staff = await currentStaff();
  if (!staff) {
    return (
      <Notice tone="warn" title="Staff sign-in required">
        The construction desk is for signed-in Corin staff. Sign in and try again.
      </Notice>
    );
  }
  const deps = getConstructionDeps();
  if (!deps) {
    return (
      <Notice tone="warn" title="The construction desk has no database yet">
        Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and apply the latest migrations.
      </Notice>
    );
  }
  return <>{await render({ deps, staff })}</>;
}

export function DeskSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="bento h-40 animate-pulse" />
      <div className="bento h-64 animate-pulse" />
    </div>
  );
}
