"use client";

import { AGENCY_GRID } from "@/lib/sizing/programs/assumptions";
import type { MultifamilyPlusInputs } from "@/lib/sizing/programs/multifamily";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "../fields";
import { EXISTING_HUD_DEFAULT } from "./defaults";
import { CreditBandField, FieldGroup, PercentField, upd, type FormProps } from "./form";

type Existing = NonNullable<MultifamilyPlusInputs["existingHud"]>;

export function MultifamilyForm({ v, set, hud223a7 }: FormProps<MultifamilyPlusInputs> & { hud223a7: boolean }) {
  const u = upd(set);
  const construction = v.transaction === "CONSTRUCTION";
  const small = v.assetType === "MULTIFAMILY" && v.units < 5;
  const residential = v.assetType !== "COMMERCIAL";
  const setHud = <K extends keyof Existing>(k: K) => (val: Existing[K]) =>
    set((p) => ({ ...p, existingHud: { ...(p.existingHud ?? EXISTING_HUD_DEFAULT), [k]: val } }));
  const optional = (k: "monthlyRent" | "monthlyTaxesInsuranceHoa" | "stabilizedNoi") => (n: number) => set((p) => ({ ...p, [k]: n || undefined }));
  return (
    <>
      <SelectField label="Asset type" value={v.assetType} onChange={u("assetType")} options={[
        { value: "MULTIFAMILY", label: "Multifamily" },
        { value: "MIXED_USE", label: "Mixed-use" },
        { value: "COMMERCIAL", label: "Commercial (office, retail, industrial)" },
      ]} />
      <Segmented label="Transaction" value={v.transaction} onChange={u("transaction")} options={[
        { value: "PURCHASE", label: "Purchase" },
        { value: "REFINANCE", label: "Refi" },
        { value: "CONSTRUCTION", label: "Build" },
      ]} />
      {v.assetType === "COMMERCIAL" ? (
        <RangeField label="Rentable sq ft" value={v.sqft} onChange={u("sqft")} min={5_000} max={500_000} step={1_000} />
      ) : (
        <RangeField label="Units" value={v.units} onChange={u("units")} min={2} max={500} />
      )}
      <MoneyField label="Loan amount" value={v.loanAmount} onChange={u("loanAmount")} />
      <MoneyField label={construction ? "As-stabilized NOI" : "In-place NOI"} value={v.noi} onChange={u("noi")} />
      <MoneyField label={construction ? "As-stabilized value" : "As-is value"} value={v.value ?? 0} onChange={(n) => set((p) => ({ ...p, value: n || undefined }))} hint="Leave blank to estimate from cap rate" />
      {construction && <MoneyField label="Total project cost (for LTC)" value={v.totalCost ?? 0} onChange={(n) => set((p) => ({ ...p, totalCost: n || undefined }))} hint="For a full budget and capital stack, use the Construction tab" />}
      {small && !construction && (
        <>
          <MoneyField label="Gross monthly rent" value={v.monthlyRent ?? 0} onChange={optional("monthlyRent")} />
          <MoneyField label="Monthly taxes, insurance and HOA" value={v.monthlyTaxesInsuranceHoa ?? 0} onChange={optional("monthlyTaxesInsuranceHoa")} />
        </>
      )}
      <Toggle label="Affordable / LIHTC" checked={v.affordable} onChange={u("affordable")} />
      <Toggle label="Green certification" hint="May improve agency pricing; no longer lowers HUD MIP" checked={v.green} onChange={u("green")} />

      {residential && !construction && (
        <FieldGroup title="Agency, bridge and DSCR options">
          <SelectField
            label="Agency fixed-rate term"
            value={String(v.agencyTermYears)}
            onChange={(t) => set((p) => ({ ...p, agencyTermYears: Number(t), agencyIoYears: Math.min(p.agencyIoYears, Number(t)) }))}
            options={AGENCY_GRID.fannie.terms.map((t) => ({ value: String(t), label: `${t} years` }))}
          />
          <RangeField label="Interest-only years" value={v.agencyIoYears} onChange={u("agencyIoYears")} min={0} max={v.agencyTermYears} />
          <PercentField label="Physical occupancy" value={(v.occupancyPct ?? 95) / 100} onChange={(n) => set((p) => ({ ...p, occupancyPct: Math.round(n * 100) }))} min={50} max={100} step={1} />
          <MoneyField label="Stabilized NOI (bridge exit test)" value={v.stabilizedNoi ?? 0} onChange={optional("stabilizedNoi")} hint="Leave blank to test on in-place NOI" />
          <CreditBandField fico={v.fico} onChange={u("fico")} />
          {v.transaction === "REFINANCE" && <Toggle label="Cash-out refinance" hint="Lowers DSCR loan leverage" checked={Boolean(v.cashOut)} onChange={u("cashOut")} />}
        </FieldGroup>
      )}

      {hud223a7 && residential && !small && v.transaction === "REFINANCE" && (
        <FieldGroup title="Existing FHA-insured loan (223(a)(7))" defaultOpen={Boolean(v.existingHud)}>
          <Toggle
            label="Refinancing a HUD-insured loan"
            checked={Boolean(v.existingHud)}
            onChange={(on) => set((p) => ({ ...p, existingHud: on ? (p.existingHud ?? EXISTING_HUD_DEFAULT) : undefined }))}
          />
          {v.existingHud && (
            <>
              <MoneyField label="Unpaid principal balance" value={v.existingHud.unpaidBalance} onChange={setHud("unpaidBalance")} />
              <MoneyField label="Original insured principal" value={v.existingHud.originalPrincipal} onChange={setHud("originalPrincipal")} />
              <PercentField label="Current note rate" value={v.existingHud.existingRatePct / 100} onChange={(n) => setHud("existingRatePct")(n * 100)} min={2} max={9} step={0.05} />
              <PercentField label="Current annual MIP" value={v.existingHud.existingAnnualMip} onChange={setHud("existingAnnualMip")} min={0.25} max={1} step={0.05} />
              <RangeField label="Remaining term (years)" value={v.existingHud.remainingTermYears} onChange={setHud("remainingTermYears")} min={1} max={40} />
              <Segmented label="Original program" value={v.existingHud.originalProgram} onChange={setHud("originalProgram")} options={[
                { value: "223F", label: "223(f)" },
                { value: "221D4", label: "221(d)(4)" },
              ]} />
              <MoneyField label="Critical repairs" value={v.existingHud.repairs} onChange={setHud("repairs")} />
            </>
          )}
        </FieldGroup>
      )}
    </>
  );
}
