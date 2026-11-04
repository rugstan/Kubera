"use client";

import type { HardMoneyInputs } from "@/lib/sizing/programs/hardMoney";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "../fields";
import { CreditBandField, FieldGroup, upd, type FormProps } from "./form";

export function HardMoneyForm({ v, set }: FormProps<HardMoneyInputs>) {
  const u = upd(set);
  const flip = v.strategy === "FIX_AND_FLIP";
  const purchase = v.purpose === "PURCHASE";
  const residential = v.propertyType === "RESIDENTIAL_1_4";
  const optional = (k: "asIsValue" | "arv" | "existingPayoff" | "stabilizedNoi" | "monthlyRent" | "monthlyTaxesInsuranceHoa") => (n: number) =>
    set((p) => ({ ...p, [k]: n || undefined }));
  return (
    <>
      <Segmented label="Strategy" value={v.strategy} onChange={u("strategy")} options={[
        { value: "FIX_AND_FLIP", label: "Fix-and-flip" },
        { value: "BRIDGE", label: "Bridge / hold" },
      ]} />
      <Segmented label="Transaction" value={v.purpose} onChange={u("purpose")} options={[
        { value: "PURCHASE", label: "Purchase" },
        { value: "REFINANCE", label: "Refi" },
      ]} />
      <SelectField
        label="Property type"
        value={v.propertyType}
        onChange={(t) => set((p) => ({ ...p, propertyType: t, units: t === "RESIDENTIAL_1_4" ? Math.min(4, Math.max(1, p.units)) : t === "MULTIFAMILY" ? Math.max(5, p.units) : p.units }))}
        options={[
          { value: "RESIDENTIAL_1_4", label: "1–4 unit residential" },
          { value: "MULTIFAMILY", label: "Multifamily (5+ units)" },
          { value: "COMMERCIAL", label: "Commercial" },
        ]}
      />
      {v.propertyType !== "COMMERCIAL" && (
        <RangeField label="Units" value={v.units} onChange={u("units")} min={residential ? 1 : 5} max={residential ? 4 : 300} />
      )}
      <MoneyField label={purchase ? "Purchase price" : "As-is value"} value={v.purchasePrice} onChange={u("purchasePrice")} />
      {purchase && <MoneyField label="Appraised as-is value" value={v.asIsValue ?? 0} onChange={optional("asIsValue")} hint="Leave blank if it matches the price" />}
      <MoneyField label="Rehab budget" value={v.rehabBudget} onChange={u("rehabBudget")} />
      <MoneyField label={flip ? "After-repair value (ARV)" : "As-stabilized value"} value={v.arv ?? 0} onChange={optional("arv")} />
      {!purchase && <MoneyField label="Existing loan payoff" value={v.existingPayoff ?? 0} onChange={optional("existingPayoff")} />}
      <MoneyField label="Loan amount" value={v.loanAmount} onChange={u("loanAmount")} hint="Purchase plus rehab funding" />
      <RangeField label="Projects completed (last 3 yrs)" value={v.completedProjects} onChange={u("completedProjects")} min={0} max={20} />

      {!flip && (
        <FieldGroup title="Exit: refinance at stabilization" defaultOpen>
          {residential ? (
            <>
              <MoneyField label="Gross monthly rent" value={v.monthlyRent ?? 0} onChange={optional("monthlyRent")} />
              <MoneyField label="Monthly taxes, insurance and HOA" value={v.monthlyTaxesInsuranceHoa ?? 0} onChange={optional("monthlyTaxesInsuranceHoa")} />
            </>
          ) : (
            <MoneyField label="Stabilized NOI" value={v.stabilizedNoi ?? 0} onChange={optional("stabilizedNoi")} />
          )}
          {v.propertyType !== "COMMERCIAL" && <CreditBandField fico={v.fico ?? 720} onChange={u("fico")} />}
        </FieldGroup>
      )}

      <FieldGroup title="Term and interest">
        <RangeField label="Loan term (months)" value={v.termMonths} onChange={u("termMonths")} min={6} max={36} />
        <RangeField label={flip ? "Months to sale" : "Months to refinance"} value={v.holdMonths} onChange={u("holdMonths")} min={1} max={48} />
        <RangeField label="Interest reserve (months)" value={v.interestReserveMonths} onChange={u("interestReserveMonths")} min={0} max={12} />
        <Toggle
          label="Interest on full commitment"
          hint="“Dutch” interest; off means interest on the drawn balance"
          checked={v.interestBasis === "FULL_COMMITMENT"}
          onChange={(on) => set((p) => ({ ...p, interestBasis: on ? "FULL_COMMITMENT" : "OUTSTANDING" }))}
        />
      </FieldGroup>
    </>
  );
}
