import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { listProjectSummaries } from "@/lib/construction/service";
import { ASSET_LABELS, PHASE_LABELS, PROGRAM_LABELS } from "@/lib/construction/types";
import { Desk, DeskSkeleton } from "./_components/Desk";
import { Chip, LicenseChip } from "./_components/ui";

export const metadata: Metadata = {
  title: "Construction desk",
  description: "Pre-closing reports, contractor licenses and construction-to-permanent conversion tracking.",
  robots: { index: false, follow: false },
};

export default function ConstructionDeskPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-10 md:px-8 md:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="eyebrow">Construction desk</p>
          <h1 className="mt-3 text-3xl font-semibold md:text-5xl">Construction projects</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-titanium">
            Third-party reports before closing, then conversion and take-out after construction. The lender of record funds and administers construction; Corin does not review draws or handle funds.
          </p>
        </div>
        <Link href="/construction/new" className="pill pill-primary">
          New project
        </Link>
      </header>
      <div className="mt-10">
        <Suspense fallback={<DeskSkeleton />}>
          <Desk render={async ({ deps }) => <ProjectTable summaries={await listProjectSummaries(deps)} />} />
        </Suspense>
      </div>
    </div>
  );
}

function ProjectTable({ summaries }: { summaries: Awaited<ReturnType<typeof listProjectSummaries>> }) {
  if (summaries.length === 0) {
    return (
      <div className="bento p-8 text-center">
        <p className="text-lg font-semibold">No construction projects yet</p>
        <p className="mt-1 text-titanium">Create one when a construction, rehab or bridge-to-permanent deal reaches the pre-closing stage.</p>
      </div>
    );
  }
  return (
    <div className="bento overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[15px]">
        <caption className="sr-only">Construction projects</caption>
        <thead className="border-b border-black/10 text-[13px] text-titanium">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">Project</th>
            <th scope="col" className="px-3 py-3 font-medium">Phase</th>
            <th scope="col" className="px-3 py-3 font-medium">Reports accepted</th>
            <th scope="col" className="px-3 py-3 font-medium">Contractor license</th>
            <th scope="col" className="px-3 py-3 font-medium">Occupancy</th>
            <th scope="col" className="px-5 py-3 font-medium">Take-out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {summaries.map((s) => (
            <tr key={s.project.id}>
              <th scope="row" className="px-5 py-4 font-normal">
                <Link href={`/construction/project?id=${s.project.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                  {s.project.name}
                </Link>
                <div className="mt-0.5 text-[13px] text-titanium">
                  {PROGRAM_LABELS[s.project.program]} · {ASSET_LABELS[s.project.assetType]}
                </div>
              </th>
              <td className="px-3 py-4">{PHASE_LABELS[s.project.phase]}</td>
              <td className="px-3 py-4">
                {s.reportsAccepted} of {s.reportsRequired}
                {s.reportsOverdue > 0 && (
                  <span className="ml-2">
                    <Chip tone="bad">{s.reportsOverdue} overdue</Chip>
                  </span>
                )}
              </td>
              <td className="px-3 py-4">
                <LicenseChip state={s.license} />
              </td>
              <td className="px-3 py-4">{s.occupancyPct === null ? "n/a" : `${s.occupancyPct}%`}</td>
              <td className="px-5 py-4">
                {s.takeoutStatus === "deal_created" ? (
                  <Chip tone="good">Deal opened</Chip>
                ) : s.takeoutTriggered ? (
                  <Chip tone="warn">Ready to start</Chip>
                ) : (
                  <Chip>Not yet</Chip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
