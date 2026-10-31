import { LICENSE_ISSUE_LABELS } from "@/lib/construction/cslb";
import type { LicenseReadiness } from "@/lib/construction/service";
import type { ConstructionProject, ContractorLicenseCheck } from "@/lib/construction/types";
import { licenseCheckAction } from "../actions";
import { ActionForm, Hidden, TextField } from "./ActionForm";
import { Card, Chip, formatDate, formatDateTime, LicenseChip } from "./ui";

const STATUS_TEXT: Record<ContractorLicenseCheck["status"], string> = {
  clear: "Clear",
  issues: "Issues found",
  not_found: "Not found at CSLB",
  lookup_unavailable: "Lookup unavailable",
};

export function LicenseSection({ project, checks, state }: { project: ConstructionProject; checks: ContractorLicenseCheck[]; state: LicenseReadiness }) {
  const latest = checks[0];
  return (
    <Card
      id="contractor"
      title="Contractor license"
      lead="Looks the general contractor up in the California Contractors State License Board public record. Repeat the check before closing."
      action={<LicenseChip state={state} />}
    >
      <ActionForm action={licenseCheckAction} submitLabel="Check with CSLB" pendingLabel="Checking" className="max-w-md">
        <Hidden name="projectId" value={project.id} />
        <TextField
          name="licenseNumber"
          label={`CSLB license number${project.generalContractorName ? ` for ${project.generalContractorName}` : ""}`}
          inputMode="numeric"
          defaultValue={project.generalContractorLicense}
          hint="Up to eight digits."
        />
      </ActionForm>

      {latest?.snapshot && (
        <dl className="mt-6 grid gap-x-8 gap-y-3 text-[15px] md:grid-cols-3">
          <Item label="Business" value={latest.snapshot.businessName ?? "Not listed"} />
          <Item label="License status" value={latest.snapshot.status} />
          <Item label="Expires" value={formatDate(latest.snapshot.expirationDate)} />
          <Item label="Classifications" value={latest.snapshot.classifications.join(", ") || "None listed"} />
          <Item label="Contractor's bond" value={latest.snapshot.bondOnFile ? "On file" : "Not on file"} />
          <Item label="Workers' compensation" value={latest.snapshot.workersCompStatus} />
        </dl>
      )}

      {latest && latest.issues.length > 0 && (
        <ul className="mt-5 list-disc space-y-1 pl-5 text-[15px] text-rose-900">
          {latest.issues.map((i) => (
            <li key={i}>{LICENSE_ISSUE_LABELS[i]}</li>
          ))}
        </ul>
      )}
      {latest?.status === "lookup_unavailable" && (
        <p className="mt-5 text-[15px] text-titanium">The CSLB lookup could not be used. Verify the license at cslb.ca.gov and note the result on the project.</p>
      )}

      {checks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[15px] font-semibold">Check history</h3>
          <ul className="mt-2 divide-y divide-black/10 text-[14px]">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {formatDateTime(c.checkedAt)} · license {c.licenseNumber} · {c.checkedBy}
                </span>
                <Chip tone={c.status === "clear" ? "good" : c.status === "issues" ? "bad" : "warn"}>{STATUS_TEXT[c.status]}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-titanium">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
