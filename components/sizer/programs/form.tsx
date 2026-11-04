"use client";

import type { ReactNode } from "react";
import { RangeField, SelectField } from "../fields";
import { CREDIT_BANDS, bandFor } from "./defaults";

export type FormProps<T> = { v: T; set: (fn: (prev: T) => T) => void };

/** Field setter factory: `u("loanAmount")(n)`. */
export const upd =
  <T,>(set: FormProps<T>["set"]) =>
  <K extends keyof T>(k: K) =>
  (val: T[K]) =>
    set((p) => ({ ...p, [k]: val }));

/** A percentage slider over a decimal value (0.05 shows as 5). */
export function PercentField({ label, value, onChange, min, max, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return <RangeField label={`${label} (%)`} value={Math.round(value * 1000) / 10} onChange={(n) => onChange(n / 100)} min={min} max={max} step={step} />;
}

export function CreditBandField({ fico, onChange }: { fico: number; onChange: (fico: number) => void }) {
  return (
    <SelectField
      label="Guarantor credit score"
      value={bandFor(fico)}
      onChange={(b) => onChange(CREDIT_BANDS.find((x) => x.value === b)?.fico ?? 720)}
      options={CREDIT_BANDS.map((b) => ({ value: b.value, label: b.label }))}
    />
  );
}

/** Collapsible group for secondary inputs, so the main form stays short. */
export function FieldGroup({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-2xl border border-black/[0.08] p-4" open={defaultOpen}>
      <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between text-sm font-medium text-ink">
        {title}
        <span aria-hidden className="text-titanium transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}
