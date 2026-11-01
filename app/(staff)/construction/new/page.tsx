import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createProjectAction } from "../actions";
import { Desk, DeskSkeleton } from "../_components/Desk";
import { ActionForm, CheckboxField, SelectField, TextAreaField, TextField } from "../_components/ActionForm";
import { ASSET_LABELS, ASSET_TYPES, CONSTRUCTION_PROGRAMS, PROGRAM_LABELS } from "@/lib/construction/types";

export const metadata: Metadata = {
  title: "New construction project",
  robots: { index: false, follow: false },
};

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-14">
      <nav aria-label="Breadcrumb" className="text-[13px] text-titanium">
        <Link href="/construction" className="hover:text-ink hover:underline">
          Construction desk
        </Link>
        <span aria-hidden> / </span>
        <span>New project</span>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold md:text-4xl">New construction project</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-titanium">
        The required third-party reports are added to the tracker from the program, state and project type. You can add or cancel reports afterwards.
      </p>
      <div className="mt-8">
        <Suspense fallback={<DeskSkeleton />}>
          <Desk render={async () => <NewProjectForm />} />
        </Suspense>
      </div>
    </div>
  );
}

function NewProjectForm() {
  return (
    <div className="bento p-5 md:p-7">
        <ActionForm action={createProjectAction} submitLabel="Create project" pendingLabel="Creating" className="grid gap-4 md:grid-cols-2">
          <TextField name="name" label="Project name" required className="md:col-span-2" />
          <SelectField name="program" label="Program" required options={CONSTRUCTION_PROGRAMS.map((p) => ({ value: p, label: PROGRAM_LABELS[p] }))} />
          <SelectField name="assetType" label="Asset type" required options={ASSET_TYPES.map((a) => ({ value: a, label: ASSET_LABELS[a] }))} />
          <TextField name="propertyAddress" label="Property address" className="md:col-span-2" />
          <TextField name="city" label="City" />
          <div className="grid grid-cols-2 gap-4">
            <TextField name="state" label="State" hint="Two letters" />
            <TextField name="zip" label="ZIP code" inputMode="numeric" />
          </div>
          <TextField name="units" label="Units or keys" type="number" inputMode="numeric" />
          <TextField name="dealId" label="Deal id" hint="Optional. Link to the deal when it exists." />
          <TextField name="generalContractorName" label="General contractor" />
          <TextField name="generalContractorLicense" label="CSLB license number" inputMode="numeric" hint="Optional now; check it later from the project page." />
          <div className="space-y-3 md:col-span-2">
            <CheckboxField name="newConstruction" label="Ground-up construction or substantial rehab" hint="Adds the plan-and-cost review and builder's risk reports." defaultChecked />
            <CheckboxField name="seismicZone" label="Site is in a seismic hazard area" hint="Adds a seismic PML. California sites get one automatically." />
          </div>
          <TextAreaField name="notes" label="Notes" className="md:col-span-2" />
        </ActionForm>
    </div>
  );
}
