"use client";

import { createContext, useActionState, useContext, useId, type ReactNode } from "react";
import { initialActionState, type ActionState } from "../state";

// Form wrapper for the construction desk's server actions. Shows the result
// message in a live region and gives each Field its inline error.

const ErrorsContext = createContext<{ errors: Record<string, string>; values: Record<string, string> }>({ errors: {}, values: {} });

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving",
  variant = "primary",
  className = "",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "glass";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className={className}>
      <ErrorsContext.Provider value={{ errors: state.fieldErrors, values: state.values }}>{children}</ErrorsContext.Provider>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`pill ${variant === "primary" ? "pill-primary" : "pill-glass"} !px-5 !py-2 !text-[15px] disabled:opacity-60`}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <p role={state.ok ? "status" : "alert"} aria-live="polite" className={`text-[14px] ${state.ok ? "text-accent-hover" : "text-rose-700"}`}>
          {state.message}
        </p>
      </div>
    </form>
  );
}

function useEcho(name: string, fallback: string | number | null | undefined): string {
  const { values } = useContext(ErrorsContext);
  return values[name] ?? String(fallback ?? "");
}

type FieldBase = { name: string; label: string; hint?: string; required?: boolean; defaultValue?: string | number | null; className?: string };

function FieldShell({ name, label, hint, required, className = "", children }: FieldBase & { children: (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode }) {
  const { errors } = useContext(ErrorsContext);
  const uid = useId();
  const id = `${uid}-${name}`;
  const error = errors[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span aria-hidden="true" className="text-rose-700"> *</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-titanium">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ type = "text", inputMode, ...p }: FieldBase & { type?: "text" | "date" | "email" | "number"; inputMode?: "numeric" | "decimal" | "email" }) {
  const shown = useEcho(p.name, p.defaultValue);
  return (
    <FieldShell {...p}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={p.name}
          type={type}
          inputMode={inputMode}
          defaultValue={shown}
          required={p.required}
          min={type === "number" ? 0 : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="field aria-[invalid=true]:border-rose-700"
        />
      )}
    </FieldShell>
  );
}

export function SelectField({ options, ...p }: FieldBase & { options: readonly { value: string; label: string }[] }) {
  const shown = useEcho(p.name, p.defaultValue);
  return (
    <FieldShell {...p}>
      {({ id, describedBy, invalid }) => (
        <select id={id} name={p.name} defaultValue={shown} required={p.required} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="field aria-[invalid=true]:border-rose-700">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField(p: FieldBase) {
  const shown = useEcho(p.name, p.defaultValue);
  return (
    <FieldShell {...p}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} name={p.name} rows={3} defaultValue={shown} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="field aria-[invalid=true]:border-rose-700" />
      )}
    </FieldShell>
  );
}

export function CheckboxField({ name, label, hint, defaultChecked = false, className = "" }: { name: string; label: string; hint?: string; defaultChecked?: boolean; className?: string }) {
  const uid = useId();
  const id = `${uid}-${name}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex items-start gap-2.5 text-[15px] text-ink">
        <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} aria-describedby={hint ? `${id}-hint` : undefined} className="mt-1 size-4 accent-[var(--color-accent)]" />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 pl-6 text-xs text-titanium">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
