import { Table } from "@/app/(staff)/deals/ui";
import { LIST_LIMITS } from "../_lib/fields";
import { date } from "../_lib/format";
import { EditorSection, type SectionProps } from "./EditorSection";
import { RowDate, RowHead, RowInput, rowCount } from "./ListRows";

// Commercial tenants only; residential tenant names never go here.

export function TenancySection({ view, write }: SectionProps) {
  const tenants = view.ctx.profile?.programDetails.tenancy?.topTenants ?? [];
  const rows = rowCount(tenants.length, LIST_LIMITS.topTenants);
  return (
    <EditorSection
      description="Top commercial tenants, largest first, and the rent that rolls inside the requested term. Tenant names may appear in the email."
      extra={
        <fieldset className="min-w-0 space-y-2 sm:col-span-2" id="field-programDetails.tenancy.topTenants">
          <legend className="field-label">Top tenants (up to {LIST_LIMITS.topTenants})</legend>
          <RowHead className="grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" cols={["Tenant", "Share of rent (%)", "Lease ends"]} />
          {Array.from({ length: rows }, (_, i) => (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" key={i}>
              <RowInput defaultValue={tenants[i]?.name} label={`Tenant ${i + 1} name`} name={`tenants.${i}.name`} />
              <RowInput defaultValue={tenants[i]?.sharePct} label={`Tenant ${i + 1} share of rent (%)`} name={`tenants.${i}.sharePct`} numeric />
              <RowDate defaultValue={tenants[i]?.leaseEnd} label={`Tenant ${i + 1} lease ends`} name={`tenants.${i}.leaseEnd`} />
            </div>
          ))}
        </fieldset>
      }
      extraReadOnly={<Table empty="No tenants entered." head={["Tenant", "Share of rent", "Lease ends"]} label="Top tenants" rows={tenants.map((t) => [t.name, `${t.sharePct}%`, date(t.leaseEnd)])} />}
      id="tenancy"
      view={view}
      write={write}
    />
  );
}
