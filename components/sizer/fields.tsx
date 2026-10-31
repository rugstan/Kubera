"use client";

import { useId, useState } from "react";
import { motion } from "motion/react";

export function MoneyField({ label, value, onChange, hint, placeholder }: { label: string; value: number; onChange: (v: number) => void; hint?: string; placeholder?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [focused, setFocused] = useState(false);
  const display = value ? (focused ? String(value) : value.toLocaleString("en-US")) : "";
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-titanium">$</span>
        <input
          id={id}
          inputMode="numeric"
          aria-describedby={hint ? hintId : undefined}
          className="field pl-7 tabular-nums"
          value={display}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
        />
      </div>
      {hint && <p id={hintId} className="mt-1 text-xs text-titanium">{hint}</p>}
    </div>
  );
}

export function RangeField({ label, value, onChange, min, max, step = 1, suffix = "" }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="field-label !mb-0">{label}</label>
        <input
          aria-label={`${label} value`}
          className="min-h-6 w-20 rounded-md bg-transparent px-1 text-right text-sm font-medium tabular-nums text-ink hover:bg-black/[0.04] focus-visible:bg-black/[0.04]"
          value={value}
          inputMode="numeric"
          onChange={(e) => onChange(Math.min(max * 2, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))}
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.16] accent-[var(--color-accent)]"
      />
      {suffix && <span className="sr-only">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const group = useId();
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="relative flex rounded-xl bg-black/[0.05] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`relative z-10 flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors ${value === o.value ? "text-ink" : "text-titanium hover:text-ink"}`}
          >
            {value === o.value && (
              <motion.span layoutId={`seg-${group}`} className="absolute inset-0 -z-10 rounded-lg bg-white shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            )}
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-titanium">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-black/50"}`}
      >
        <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 35 }} className={`absolute top-[2px] size-[22px] rounded-full bg-white shadow ${checked ? "right-[2px]" : "left-[2px]"}`} />
      </button>
    </label>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} className="field appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 4.5l3 3 3-3%22 stroke=%22%2386868b%22 fill=%22none%22 stroke-width=%221.5%22/></svg>')] bg-[length:12px] bg-[right_0.9rem_center] bg-no-repeat pr-9" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
