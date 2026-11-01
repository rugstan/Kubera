"use client";

import { useState, type ReactNode } from "react";
import { Controller, useFormContext, type ControllerRenderProps, type FieldValues } from "react-hook-form";
import { controlAria, fieldIds, formatNumeric, parseNumeric } from "./ids";

// Accessible form controls bound to react-hook-form through context. Every
// control gets a visible label, a programmatic name, aria-required when
// required, aria-invalid plus aria-describedby (hint, then error) when
// invalid, and a red border that does not depend on colour alone (the error
// text with its icon sits right under it).

const INVALID = "aria-[invalid=true]:border-danger";

type Common = {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
};

type Bound = { field: ControllerRenderProps<FieldValues, string>; error: string | undefined };

/**
 * Binds a field name to react-hook-form and hands the render function its props and current error text.
 * Once a field shows an error, every change re-checks it, so the message clears the moment the answer
 * is fixed (the form's own "validate after blur" mode would wait for the next blur).
 */
function Bind({ name, children }: { name: string; children: (b: Bound) => ReactNode }) {
  const { control, trigger } = useFormContext();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const error = typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined;
        const onChange: typeof field.onChange = (...args) => {
          field.onChange(...args);
          if (error) void trigger(name);
        };
        return <>{children({ field: { ...field, onChange }, error })}</>;
      }}
    />
  );
}

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}
      *
    </span>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-danger">
      <svg viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.25h1.5v4h-1.5v-4Zm.75 6.5a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-titanium">
      {children}
    </p>
  );
}

function Label({ htmlFor, children, required }: { htmlFor: string; children: ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="field-label">
      {children}
      {required && <RequiredMark />}
    </label>
  );
}

// --- Text -----------------------------------------------------------------------

type TextProps = Common & {
  type?: "text" | "email" | "tel" | "url";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "url" | "numeric" | "decimal";
  placeholder?: string;
  maxLength?: number;
};

export function TextField({ name, label, hint, required, className = "", type = "text", autoComplete, inputMode, placeholder, maxLength }: TextProps) {
  const ids = fieldIds(name);
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <Label htmlFor={ids.id} required={required}>
            {label}
          </Label>
          <input
            {...controlAria({ name, hasHint: Boolean(hint), error, required })}
            ref={field.ref}
            name={field.name}
            value={(field.value as string | undefined) ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            type={type}
            autoComplete={autoComplete}
            inputMode={inputMode}
            placeholder={placeholder}
            maxLength={maxLength}
            className={`field ${INVALID}`}
          />
          {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}

export function TextAreaField({ name, label, hint, required, className = "", placeholder, maxLength }: Common & { placeholder?: string; maxLength?: number }) {
  const ids = fieldIds(name);
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <Label htmlFor={ids.id} required={required}>
            {label}
          </Label>
          <textarea
            {...controlAria({ name, hasHint: Boolean(hint), error, required })}
            ref={field.ref}
            name={field.name}
            value={(field.value as string | undefined) ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            maxLength={maxLength}
            className={`field min-h-24 ${INVALID}`}
          />
          {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}

// --- Numbers --------------------------------------------------------------------

type NumericProps = Common & {
  format: "money" | "integer" | "decimal";
  placeholder?: string;
  suffix?: string;
};

/** Stores `number | null`. While focused it shows exactly what was typed; otherwise grouped digits. */
export function NumericField({ name, label, hint, required, className = "", format, placeholder, suffix }: NumericProps) {
  const [typed, setTyped] = useState<string | null>(null);
  const ids = fieldIds(name);
  const prefix = format === "money" ? "$" : undefined;
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <Label htmlFor={ids.id} required={required}>
            {label}
          </Label>
          <div className="relative">
            {prefix && (
              <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-titanium">
                {prefix}
              </span>
            )}
            <input
              {...controlAria({ name, hasHint: Boolean(hint), error, required })}
              ref={field.ref}
              name={field.name}
              inputMode={format === "decimal" ? "decimal" : "numeric"}
              autoComplete="off"
              value={typed ?? formatNumeric(field.value as number | null | undefined, format)}
              placeholder={placeholder}
              onFocus={() => setTyped(formatNumeric(field.value as number | null | undefined, format).replace(/,/g, ""))}
              onChange={(e) => {
                setTyped(e.target.value);
                field.onChange(parseNumeric(e.target.value, { integer: format === "integer" }));
              }}
              onBlur={() => {
                setTyped(null);
                field.onBlur();
              }}
              className={`field tabular-nums ${prefix ? "pl-7" : ""} ${suffix ? "pr-9" : ""} ${INVALID}`}
            />
            {suffix && (
              <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-titanium">
                {suffix}
              </span>
            )}
          </div>
          {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}

// --- Select ---------------------------------------------------------------------

export type Option<T extends string = string> = { value: T; label: string; hint?: string };

export function SelectField({ name, label, hint, required, className = "", options, placeholder = "Select one" }: Common & { options: readonly Option[]; placeholder?: string }) {
  const ids = fieldIds(name);
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <Label htmlFor={ids.id} required={required}>
            {label}
          </Label>
          <select
            {...controlAria({ name, hasHint: Boolean(hint), error, required })}
            ref={field.ref}
            name={field.name}
            value={(field.value as string | undefined) ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            className={`field appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 4.5l3 3 3-3%22 stroke=%22%2386868b%22 fill=%22none%22 stroke-width=%221.5%22/></svg>')] bg-[length:12px] bg-[right_0.9rem_center] bg-no-repeat pr-9 ${INVALID}`}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}

// --- Choice groups ---------------------------------------------------------------

const CHOICE_BASE =
  "relative flex min-h-11 cursor-pointer items-center justify-center rounded-xl border bg-white px-3 py-2 text-center text-[14px] font-medium text-ink transition has-[input:checked]:border-accent has-[input:checked]:bg-accent/5 has-[input:checked]:text-accent-hover has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent hover:border-black/50";

function descriptionIds(name: string, hint: ReactNode, error: string | undefined) {
  const ids = fieldIds(name);
  return [hint ? ids.hintId : null, error ? ids.errorId : null].filter(Boolean).join(" ") || undefined;
}

/**
 * One answer from a few options: native radio inputs (arrow keys, one tab
 * stop) styled as buttons, inside a labelled radiogroup. `layout="cards"` is
 * for longer labels.
 */
export function ChoiceField({ name, label, hint, required, className = "", options, layout = "row" }: Common & { options: readonly Option[]; layout?: "row" | "cards" }) {
  const ids = fieldIds(name);
  const labelId = `${ids.id}-label`;
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <p id={labelId} className="field-label">
            {label}
            {required && <RequiredMark />}
          </p>
          <div
            id={ids.id}
            role="radiogroup"
            aria-labelledby={labelId}
            aria-describedby={descriptionIds(name, hint, error)}
            aria-required={required ? true : undefined}
            aria-invalid={error ? true : undefined}
            className={layout === "cards" ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "flex flex-wrap gap-2"}
          >
            {options.map((o, i) => (
              <label key={o.value} className={`${CHOICE_BASE} ${layout === "row" ? "flex-1 basis-24" : "justify-start text-left"} ${error ? "border-danger" : "border-black/30"}`}>
                <input
                  ref={i === 0 ? field.ref : undefined}
                  type="radio"
                  className="sr-only"
                  name={field.name}
                  value={o.value}
                  checked={field.value === o.value}
                  onChange={() => field.onChange(o.value)}
                  onBlur={field.onBlur}
                />
                <span>
                  {o.label}
                  {o.hint && <span className="block text-xs font-normal text-titanium">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
          {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}

/** Pick any number of options (checkboxes styled as chips). Stores string[]. */
export function ChipsField({ name, label, hint, required, className = "", options }: Common & { options: readonly Option[] }) {
  const ids = fieldIds(name);
  return (
    <Bind name={name}>
      {({ field, error }) => {
        const value = (field.value as string[] | undefined) ?? [];
        return (
          <fieldset id={ids.id} className={className} aria-describedby={descriptionIds(name, hint, error)} tabIndex={-1}>
            <legend className="field-label">
              {label}
              {required && <RequiredMark />}
            </legend>
            <div className="flex flex-wrap gap-2">
              {options.map((o, i) => {
                const on = value.includes(o.value);
                return (
                  <label
                    key={o.value}
                    className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-[14px] font-medium transition has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent ${on ? "border-accent bg-accent/10 text-accent-hover" : error ? "border-danger text-ink/80" : "border-black/30 text-ink/80 hover:border-black/50"}`}
                  >
                    <input
                      ref={i === 0 ? field.ref : undefined}
                      type="checkbox"
                      className="sr-only"
                      name={field.name}
                      value={o.value}
                      checked={on}
                      aria-invalid={error ? true : undefined}
                      onChange={() => field.onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                      onBlur={field.onBlur}
                    />
                    {on && (
                      <svg viewBox="0 0 16 16" className="mr-1.5 size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {o.label}
                  </label>
                );
              })}
            </div>
            {hint && <Hint id={ids.hintId}>{hint}</Hint>}
            {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
          </fieldset>
        );
      }}
    </Bind>
  );
}

// --- Checkbox ---------------------------------------------------------------------

export function CheckboxField({ name, label, hint, required, className = "", boxed = false }: Common & { boxed?: boolean }) {
  const ids = fieldIds(name);
  return (
    <Bind name={name}>
      {({ field, error }) => (
        <div className={className}>
          <div className={boxed ? "rounded-2xl bg-white p-4" : ""}>
            <label htmlFor={ids.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-[13px] leading-relaxed text-ink/80">
              <input
                {...controlAria({ name, hasHint: Boolean(hint), error, required })}
                ref={field.ref}
                name={field.name}
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                {label}
                {required && <RequiredMark />}
              </span>
            </label>
            {hint && <Hint id={ids.hintId}>{hint}</Hint>}
          </div>
          {error && <ErrorText id={ids.errorId}>{error}</ErrorText>}
        </div>
      )}
    </Bind>
  );
}
