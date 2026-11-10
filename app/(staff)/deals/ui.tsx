// Presentational pieces shared by the deal desk pages (server components).

import Link from "next/link";
import { LENDER_LOAN_TYPE_GROUPS, LENDER_LOAN_TYPE_LABELS, LENDER_LOAN_TYPE_SHORT_LABELS, type LenderLoanType } from "@/lib/deals/loan-types";
import { formatCents } from "@/lib/deals/money";

export function money(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : formatCents(cents);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: iso.length > 10 ? "short" : undefined });
}

export function Section({ title, id, children, description }: { title: string; id?: string; description?: string; children: React.ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className="bento p-5 sm:p-6" id={id}>
      <h2 className="text-lg font-semibold text-ink" id={headingId}>
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-titanium">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-black/5 text-ink",
    good: "bg-success-surface text-success",
    warn: "bg-warning-surface text-warning",
    bad: "bg-danger-surface text-danger",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div className={`rounded-2xl px-4 py-3 text-sm ${error ? "notice-danger" : "notice-success"}`} role={error ? "alert" : "status"}>
      {error ?? notice}
    </div>
  );
}

/**
 * Pages whose h1 sits inside the Suspense boundary (a deal or credit box title)
 * pass `level={1}` so the fallback still gives the page its one h1.
 */
type HeadingLevel = { level?: 1 | 2 };

export function SignInRequired({ level = 2 }: HeadingLevel = {}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="bento p-6">
      <H className="text-lg font-semibold text-ink">Staff sign-in required</H>
      <p className="mt-2 text-sm text-titanium">The deal desk is available to Corin staff signed in with multi-factor authentication.</p>
      <Link className="pill pill-primary mt-4 inline-flex" href="/login">
        Sign in
      </Link>
    </div>
  );
}

export function NotConfigured({ level = 2 }: HeadingLevel = {}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="bento p-6">
      <H className="text-lg font-semibold text-ink">Deal desk storage is not configured</H>
      <p className="mt-2 text-sm text-titanium">Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load deal records.</p>
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p aria-busy="true" className="text-sm text-titanium">
      Loading {label}…
    </p>
  );
}

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  step?: string;
  hint?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  spellCheck?: boolean;
  /** Makes the hint id `${idPrefix}-${name}-hint`; per-row forms pass one so ids never repeat. */
  idPrefix?: string;
  /** Asks password managers not to offer to fill or save this field (account numbers). */
  passwordManagerIgnore?: boolean;
};

export function Field({ label, name, type = "text", defaultValue, required, placeholder, step, hint, autoComplete, inputMode, maxLength, spellCheck, idPrefix, passwordManagerIgnore }: FieldProps) {
  const hintId = hint ? `${idPrefix ? `${idPrefix}-` : ""}${name}-hint` : undefined;
  const ignore = passwordManagerIgnore ? { "data-1p-ignore": "true", "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } : {};
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input
        aria-describedby={hintId}
        autoComplete={autoComplete}
        className="field"
        defaultValue={defaultValue ?? undefined}
        inputMode={inputMode}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
        spellCheck={spellCheck}
        step={step}
        type={type}
        {...ignore}
      />
      {hint ? (
        <span className="mt-1 block text-xs text-titanium" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextArea({ label, name, defaultValue, maxLength, hint, rows = 4, idPrefix }: { label: string; name: string; defaultValue?: string | null; maxLength?: number; hint?: string; rows?: number; idPrefix?: string }) {
  const hintId = hint ? `${idPrefix ? `${idPrefix}-` : ""}${name}-hint` : undefined;
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea aria-describedby={hintId} className="field" defaultValue={defaultValue ?? undefined} maxLength={maxLength} name={name} rows={rows} />
      {hint ? (
        <span className="mt-1 block text-xs text-titanium" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Select({ label, name, options, defaultValue, required }: { label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <select className="field" defaultValue={defaultValue} name={name} required={required}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input className="size-4 accent-[var(--color-accent)]" defaultChecked={defaultChecked} name={name} type="checkbox" value="on" />
      {label}
    </label>
  );
}

/**
 * A form's submit button. `.pill` keeps labels on one line; here a label wider
 * than its container wraps instead, so long action names ("Check waiting
 * outreach for broker decisions") never widen a 390px layout (WCAG 1.4.10).
 */
export function Submit({ children, tone = "primary", name, value }: { children: React.ReactNode; tone?: "primary" | "glass"; name?: string; value?: string }) {
  return (
    <button className={`pill ${tone === "primary" ? "pill-primary" : "pill-glass"} min-h-11 max-w-full whitespace-normal text-center`} name={name} type="submit" value={value}>
      {children}
    </button>
  );
}

/**
 * Wide tables scroll inside their own box on narrow screens. The box is a
 * focusable, named region so keyboard users can scroll it (WCAG 2.1.1).
 */
export function Table({ head, rows, empty, label }: { head: string[]; rows: React.ReactNode[][]; empty: string; label?: string }) {
  if (!rows.length) return <p className="text-sm text-titanium">{empty}</p>;
  return (
    <div aria-label={label ?? `Table: ${head.join(", ")}`} className="-mx-1 overflow-x-auto" role="region" tabIndex={0}>
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-titanium">
            {head.map((h) => (
              <th className="px-1 py-2 font-medium" key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr className="border-b border-black/5 align-top" key={i}>
              {r.map((c, j) => (
                <td className="px-1 py-2" key={j}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHIP =
  "group inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-black/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-black/50 has-[input:checked]:border-accent has-[input:checked]:bg-accent/10 has-[input:checked]:text-accent-hover has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent";

/** Loan-type checkboxes as chips, grouped by LENDER_LOAN_TYPE_GROUPS. Native checkboxes: work in a GET form with no JS. */
export function LoanTypeFieldset({ legend, name, selected, counts }: { legend: string; name: string; selected: readonly LenderLoanType[]; counts?: Record<LenderLoanType, number> }) {
  return (
    <fieldset>
      <legend className="field-label">{legend}</legend>
      <div className="mt-1 grid gap-3">
        {LENDER_LOAN_TYPE_GROUPS.map((g) => (
          <fieldset key={g.label}>
            <legend className="text-xs font-medium uppercase tracking-wide text-titanium">{g.label}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {g.types.map((t) => (
                <label className={CHIP} key={t}>
                  <input className="size-4 accent-[var(--color-accent)]" defaultChecked={selected.includes(t)} name={name} type="checkbox" value={t} />
                  {LENDER_LOAN_TYPE_LABELS[t]}
                  {counts ? <span className="text-titanium group-has-[input:checked]:text-accent-hover">({counts[t]})</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}

export function LoanTypeBadges({ types, empty = "No loan types" }: { types: readonly LenderLoanType[]; empty?: string }) {
  if (!types.length) return <span className="text-xs text-titanium">{empty}</span>;
  return (
    <ul aria-label="Loan types" className="flex flex-wrap gap-1">
      {types.map((t) => (
        <li key={t}>
          <Badge>{LENDER_LOAN_TYPE_SHORT_LABELS[t]}</Badge>
        </li>
      ))}
    </ul>
  );
}
