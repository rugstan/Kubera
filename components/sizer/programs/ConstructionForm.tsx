"use client";

import type { ConstructionInputs, TakeoutKind } from "@/lib/sizing/programs/construction";
import { defaultTakeout } from "@/lib/sizing/programs/construction";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "../fields";
import { FieldGroup, PercentField, upd, type FormProps } from "./form";

const TAKEOUTS: { value: TakeoutKind; label: string; multifamilyOnly: boolean }[] = [
  { value: "AGENCY", label: "Agency (Fannie / Freddie)", multifamilyOnly: true },
  { value: "HUD_223F", label: "HUD 223(f)", multifamilyOnly: true },
  { value: "BANK_PERM", label: "Bank permanent loan", multifamilyOnly: false },
];

export function ConstructionForm({ v, set }: FormProps<ConstructionInputs>) {
  const u = upd(set);
  const residential = v.assetType === "MULTIFAMILY" || v.assetType === "MIXED_USE";
  const takeout = v.takeout ?? defaultTakeout(v);
  const takeouts = TAKEOUTS.filter((t) => residential || !t.multifamilyOnly);
  return (
    <>
      <SelectField
        label="Asset type"
        value={v.assetType}
        onChange={(a) => set((p) => ({ ...p, assetType: a, takeout: a === "MULTIFAMILY" || a === "MIXED_USE" ? p.takeout : "BANK_PERM" }))}
        options={[
          { value: "MULTIFAMILY", label: "Multifamily" },
          { value: "MIXED_USE", label: "Mixed-use" },
          { value: "COMMERCIAL", label: "Commercial (industrial, retail, office)" },
          { value: "HOTEL", label: "Hotel" },
        ]}
      />
      {v.assetType !== "COMMERCIAL" && <RangeField label={v.assetType === "HOTEL" ? "Keys" : "Units"} value={v.units} onChange={u("units")} min={2} max={500} />}
      <MoneyField label="Land cost" value={v.landCost} onChange={u("landCost")} />
      <MoneyField label="Hard costs" value={v.hardCosts} onChange={u("hardCosts")} />
      <MoneyField label="Soft costs" value={v.softCosts} onChange={u("softCosts")} hint="Design, permits, fees, insurance, marketing" />
      <MoneyField label="Senior loan requested" value={v.loanAmount} onChange={u("loanAmount")} />
      <MoneyField label="Stabilized NOI" value={v.stabilizedNoi} onChange={u("stabilizedNoi")} />
      <MoneyField label="As-completed value" value={v.asCompletedValue ?? 0} onChange={(n) => set((p) => ({ ...p, asCompletedValue: n || undefined }))} hint="Leave blank to estimate from a cap rate" />
      <RangeField label="Ground-up projects completed" value={v.completedProjects} onChange={u("completedProjects")} min={0} max={20} />

      <FieldGroup title="Budget and schedule">
        <Toggle label="GMP contract" hint="A guaranteed-maximum-price contract lowers the contingency lenders require" checked={v.gmpContract} onChange={u("gmpContract")} />
        <PercentField label="Hard-cost contingency" value={v.contingencyPct} onChange={u("contingencyPct")} min={0} max={15} />
        <PercentField label="Developer fee" value={v.developerFeePct} onChange={u("developerFeePct")} min={0} max={8} />
        <RangeField label="Construction (months)" value={v.constructionMonths} onChange={u("constructionMonths")} min={6} max={36} />
        <RangeField label="Lease-up (months)" value={v.leaseUpMonths} onChange={u("leaseUpMonths")} min={0} max={24} />
      </FieldGroup>

      <FieldGroup title="Capital stack and take-out">
        <Segmented label="Mezzanine to" value={String(v.mezzTargetLtc)} onChange={(s) => set((p) => ({ ...p, mezzTargetLtc: Number(s) }))} options={[
          { value: "0", label: "None" },
          { value: "0.75", label: "75%" },
          { value: "0.8", label: "80%" },
          { value: "0.85", label: "85%" },
        ]} />
        <Segmented label="Preferred equity to" value={String(v.prefTargetLtc)} onChange={(s) => set((p) => ({ ...p, prefTargetLtc: Number(s) }))} options={[
          { value: "0", label: "None" },
          { value: "0.85", label: "85%" },
          { value: "0.9", label: "90%" },
        ]} />
        <MoneyField label="C-PACE" value={v.cpaceAmount} onChange={u("cpaceAmount")} hint="Energy, water and seismic work; needs senior lender consent" />
        <SelectField label="Take-out at stabilization" value={takeout} onChange={(t) => set((p) => ({ ...p, takeout: t }))} options={takeouts.map(({ value, label }) => ({ value, label }))} />
      </FieldGroup>
    </>
  );
}
