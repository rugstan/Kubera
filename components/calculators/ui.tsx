"use client";

import { useId, type ReactNode } from "react";

// Small form and result building blocks for the calculators. Controlled inputs
// with visible labels, aria-invalid / aria-describedby on errors, and a live
// region around the results so a screen reader hears the numbers change.

export function CalcField({
  label,
  hint,
  error,
  value,
  onChange,
  onBlur,
  prefix,
  suffix,
  placeholder,
  inputMode = "decimal",
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
  optional?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="font-normal"> (optional)</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-titanium">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`field aria-[invalid=true]:border-danger ${prefix ? "pl-7" : ""} ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-titanium">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-titanium">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-[13px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function CalcSelect({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? hintId : undefined} className="field">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-titanium">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CalcCheckbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (next: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? hintId : undefined}
        className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
      />
      <label htmlFor={id} className="text-[15px] leading-snug text-ink">
        {label}
        {hint && (
          <span id={hintId} className="mt-0.5 block text-xs text-titanium">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-success" : tone === "warn" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-2xl bg-white p-4">
      <dt className="text-[13px] text-titanium">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</dd>
      {note && <dd className="mt-1 text-xs leading-snug text-titanium">{note}</dd>}
    </div>
  );
}

/** Two-column layout: inputs on the left, results on the right at md and up. */
export function CalcLayout({ inputs, results }: { inputs: ReactNode; results: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-8">
      <div className="bento min-w-0 p-6 md:p-7">{inputs}</div>
      <div aria-live="polite" aria-atomic="false" className="bento min-w-0 p-6 md:p-7">
        {results}
      </div>
    </div>
  );
}

export function EmptyResults({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-titanium">{children}</p>;
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="space-y-1 text-[14px] text-danger">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function ExampleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[14px] font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
      Fill in an example
    </button>
  );
}

export function RateNote({ asOf, live, children }: { asOf: string; live: boolean; children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-titanium">
      {children} Benchmarks as of {asOf} ({live ? "FRED, live" : "indicative; the live feed was unavailable"}).
    </p>
  );
}
