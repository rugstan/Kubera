import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deskServices } from "@/lib/checklists/server";
import { CHECKLIST_PROGRAMS, PROGRAM_LABEL } from "@/lib/checklists/types";
import { createChecklistAction } from "./actions";
import { signOutAction } from "@/app/(auth)/actions";
import { currentStaff } from "./_lib/session";
import { Card, date, first, Notice, SignIn, type SearchParams } from "./_components/ui";

export const metadata: Metadata = { title: "Checklists" };

export default function ChecklistsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <p className="eyebrow">Deal desk</p>
      <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Deal checklists</h1>
      <p className="mt-2 max-w-2xl text-[15px] text-ink/80">Pre-closing document checklists, conditions, principals and sanctions screening for each deal Corin brokers.</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-[15px] text-ink/80">Loading the desk…</p>}>
          <Desk searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Desk({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const staff = await currentStaff();
  if (!staff) return <SignIn />;
  const s = deskServices();
  if (!s) {
    return (
      <Card title="The deal desk is not available">
        <p className="text-[15px] text-ink/80">The database is not configured for this deployment (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).</p>
      </Card>
    );
  }
  const checklists = await s.checklists.listChecklists({ limit: 100 });
  const byDeal = new Map<string, typeof checklists>();
  for (const c of checklists) byDeal.set(c.dealId, [...(byDeal.get(c.dealId) ?? []), c]);

  return (
    <>
      <Notice ok={first(sp.ok)} error={first(sp.error)} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[15px]">
        <p>
          Signed in as <strong>{staff.name}</strong> ({staff.email}, {staff.role})
        </p>
        <form action={signOutAction}>
          <button type="submit" className="pill pill-glass !px-4 !py-2 !text-[15px]">
            Sign out
          </button>
        </form>
      </div>

      <Card id="new" title="Start a checklist">
        <form action={createChecklistAction} className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="new-deal" className="field-label">
              Deal id
            </label>
            <input id="new-deal" name="dealId" required pattern="[0-9a-fA-F-]{36}" placeholder="UUID from the pipeline" className="field" />
          </div>
          <div>
            <label htmlFor="new-program" className="field-label">
              Program
            </label>
            <select id="new-program" name="program" required className="field">
              {CHECKLIST_PROGRAMS.map((p) => (
                <option key={p} value={p}>
                  {PROGRAM_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-lead" className="field-label">
              Lead id (optional)
            </label>
            <input id="new-lead" name="leadId" pattern="[0-9a-fA-F-]{36}" className="field" />
          </div>
          <button type="submit" className="pill pill-primary">
            Create
          </button>
        </form>
      </Card>

      <Card id="deals" title={`Deals (${byDeal.size})`}>
        {byDeal.size === 0 ? (
          <p className="text-[15px] text-ink/80">No checklists yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[15px]">
              <thead className="text-[13px] text-ink/80">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Deal
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Checklists
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...byDeal.entries()].map(([dealId, list]) => (
                  <tr key={dealId} className="border-t border-black/10">
                    <td className="py-2 pr-4 font-mono text-[13px]">
                      <Link href={`/checklists/deal?id=${dealId}`} className="text-accent underline underline-offset-2">
                        {dealId}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{list.map((c) => PROGRAM_LABEL[c.program]).join(", ")}</td>
                    <td className="py-2">{date(list.map((c) => c.createdAt).sort()[0])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
