import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProjectOverview } from "@/lib/construction/service";
import { ASSET_LABELS, PHASE_LABELS, PROGRAM_LABELS } from "@/lib/construction/types";
import { ActivitySection } from "../_components/ActivitySection";
import { ConversionSection } from "../_components/ConversionSection";
import { Desk, DeskSkeleton } from "../_components/Desk";
import { LicenseSection } from "../_components/LicenseSection";
import { ReportsSection } from "../_components/ReportsSection";
import { Chip } from "../_components/ui";

export const metadata: Metadata = {
  title: "Construction project",
  robots: { index: false, follow: false },
};

// The project id travels as a query parameter rather than a route segment: the
// root layout's command bar reads the pathname, and a dynamic segment would make
// every request block on it during prerendering.
type Props = { searchParams: Promise<{ id?: string | string[] }> };

export default function ConstructionProjectPage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-10 md:px-8 md:py-14">
      <nav aria-label="Breadcrumb" className="text-[13px] text-titanium">
        <Link href="/construction" className="hover:text-ink hover:underline">
          Construction desk
        </Link>
      </nav>
      <Suspense fallback={<DeskSkeleton />}>
        <ProjectDetail searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProjectDetail({ searchParams }: Props) {
  const { id: rawId } = await searchParams;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) notFound();
  return (
    <Desk
      render={async ({ deps }) => {
        const overview = await getProjectOverview(deps, id);
        if (!overview) notFound();
        const { project, reports, readiness, licenseChecks, license, conversion, events } = overview;
        return (
          <>
            <header className="mt-4">
              <h1 className="text-3xl font-semibold md:text-5xl">{project.name}</h1>
              <p className="mt-2 text-[17px] text-titanium">
                {PROGRAM_LABELS[project.program]} · {ASSET_LABELS[project.assetType]}
                {project.units ? ` · ${project.units} units` : ""}
              </p>
              <p className="mt-1 text-[15px] text-titanium">{[project.propertyAddress, project.city, [project.state, project.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "No address yet"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Chip>{PHASE_LABELS[project.phase]}</Chip>
                <Chip tone={readiness.ready ? "good" : "warn"}>{readiness.ready ? "Reports ready" : `${readiness.blockers.length} reports open`}</Chip>
              </div>
              <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px] font-medium text-accent">
                <a href="#reports" className="hover:underline">Reports</a>
                <a href="#contractor" className="hover:underline">Contractor</a>
                <a href="#conversion" className="hover:underline">Conversion</a>
                <a href="#leaseup" className="hover:underline">Lease-up</a>
                <a href="#takeout" className="hover:underline">Take-out</a>
                <a href="#activity" className="hover:underline">Activity</a>
              </nav>
            </header>
            <div className="mt-8 space-y-6">
              <ReportsSection projectId={project.id} reports={reports} readiness={readiness} now={deps.now()} />
              <LicenseSection project={project} checks={licenseChecks} state={license} />
              <ConversionSection project={project} view={conversion} />
              <ActivitySection events={events} />
            </div>
          </>
        );
      }}
    />
  );
}
