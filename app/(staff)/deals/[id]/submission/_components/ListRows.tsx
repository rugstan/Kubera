// Inputs for the editor's repeating lines (sources and uses, known issues,
// tenants, unit mix). Each cell is labelled for assistive technology
// ("Source 2 amount (USD)") and carries id="field-<name>" so a refused save
// links straight to it. Rows stack on phones and line up from sm.

import type { Option } from "../_lib/fields";

export function RowInput({ name, label, defaultValue, numeric, wide }: { name: string; label: string; defaultValue?: string | number | null; numeric?: boolean; wide?: boolean }) {
  return (
    <input
      aria-label={label}
      autoComplete="off"
      className={`field min-w-0 ${wide ? "sm:col-span-2" : ""}`}
      defaultValue={defaultValue ?? undefined}
      id={`field-${name}`}
      inputMode={numeric ? "decimal" : undefined}
      name={name}
      placeholder={label.replace(/^.*? \d+ /, "")}
      type="text"
    />
  );
}

export function RowDate({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string | null }) {
  return <input aria-label={label} className="field min-w-0" defaultValue={defaultValue ?? undefined} id={`field-${name}`} name={name} type="date" />;
}

export function RowSelect({ name, label, options, defaultValue }: { name: string; label: string; options: readonly Option[]; defaultValue?: string | null }) {
  return (
    <select aria-label={label} className="field min-w-0" defaultValue={defaultValue ?? ""} id={`field-${name}`} name={name}>
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Column captions shown from sm up (each input has its own accessible name). */
export function RowHead({ cols, className }: { cols: string[]; className: string }) {
  return (
    <div aria-hidden="true" className={`hidden gap-2 text-xs font-medium uppercase tracking-wide text-titanium sm:grid ${className}`}>
      {cols.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

/** Existing rows plus a few blank ones, never past the limit. */
export function rowCount(existing: number, limit: number, blank = 3): number {
  return Math.min(limit, existing + blank);
}
