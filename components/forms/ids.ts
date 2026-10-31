// Deterministic element ids for form fields. The id of a control, its hint and
// its error message derive from the field name, so aria-describedby, the label's
// htmlFor and the error summary's links always agree.

export type FieldIds = { id: string; hintId: string; errorId: string };

export function fieldId(name: string): string {
  return `f-${name.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

export function fieldIds(name: string): FieldIds {
  const id = fieldId(name);
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

/** Joins the ids that describe a control; undefined when there are none (so no empty attribute renders). */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const out = ids.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length ? out.join(" ") : undefined;
}

export type ControlAria = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
};

/** The ARIA attributes every form control carries. */
export function controlAria(args: { name: string; hasHint?: boolean; error?: string; required?: boolean }): ControlAria {
  const ids = fieldIds(args.name);
  return {
    id: ids.id,
    "aria-invalid": args.error ? true : undefined,
    "aria-describedby": describedBy(args.hasHint && ids.hintId, args.error && ids.errorId),
    "aria-required": args.required ? true : undefined,
  };
}

/** Parses a typed number: tolerant of $, commas and spaces; empty or unparseable input is null. */
export function parseNumeric(raw: string, opts: { integer?: boolean } = {}): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return opts.integer ? Math.trunc(n) : n;
}

/** Display text for a numeric value when the input is not focused. */
export function formatNumeric(value: number | null | undefined, format: "money" | "integer" | "decimal"): string {
  if (value === null || value === undefined) return "";
  if (format === "decimal") return String(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: format === "money" ? 2 : 0 });
}
