// Maps what the API routes answer (see app/api/qualify and app/api/partners:
// `{ error }` or `{ error, issues: [{ path, message }] }`, plus the guard's
// 403/413/415/429 replies) onto messages a person can act on, and onto
// per-field errors when the server rejected specific fields.

export type FailureKind = "validation" | "rate_limit" | "verification" | "too_large" | "server" | "network";

export type FormFailure = {
  kind: FailureKind;
  /** The banner message. */
  message: string;
  /** Field name -> message, for the fields the server rejected that this form has. */
  fieldErrors: Record<string, string>;
  status?: number;
};

export type MapOptions = {
  /** Field names the form has. Server paths are matched to these by their last segment. */
  fields?: readonly string[];
  /** Human labels by field name, used when an error cannot be shown inline. */
  labels?: Record<string, string>;
  contactEmail?: string;
};

const DEFAULT_EMAIL = "deals@kuberacommercial.com";

/** Zod's default messages are developer-facing; turn them into plain language. */
export function friendlyIssueMessage(message: string): string {
  const m = message.trim();
  if (/^invalid email/i.test(m)) return "Enter a valid email address.";
  if (/^invalid url/i.test(m)) return "Enter a full web address that starts with https://.";
  if (/^invalid input|^too small|^too big|expected .* received|^invalid (option|literal)|^required$/i.test(m)) return "Check this entry.";
  return m.endsWith(".") ? m : `${m}.`;
}

/** "contact.email" -> "email"; "services.0" -> "services". */
export function leafOfPath(path: string): string {
  const parts = path.split(".").filter((p) => p && !/^\d+$/.test(p));
  return parts[parts.length - 1] ?? "";
}

function readIssues(body: unknown): { path: string; message: string }[] {
  if (!body || typeof body !== "object" || !("issues" in body) || !Array.isArray(body.issues)) return [];
  return body.issues.flatMap((i: unknown) => {
    if (!i || typeof i !== "object") return [];
    const { path, message } = i as { path?: unknown; message?: unknown };
    return typeof message === "string" ? [{ path: typeof path === "string" ? path : "", message }] : [];
  });
}

function readError(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.trim()) return body.error.trim();
  return undefined;
}

export function mapServerFailure(status: number, body: unknown, opts: MapOptions = {}): FormFailure {
  const email = opts.contactEmail ?? DEFAULT_EMAIL;
  const serverMessage = readError(body);

  if (status === 400) {
    const issues = readIssues(body);
    const known = new Set(opts.fields ?? []);
    const fieldErrors: Record<string, string> = {};
    const unplaced: string[] = [];
    for (const issue of issues) {
      const leaf = leafOfPath(issue.path);
      const text = friendlyIssueMessage(issue.message);
      if (leaf && known.has(leaf)) fieldErrors[leaf] ??= text;
      else unplaced.push(leaf ? `${opts.labels?.[leaf] ?? leaf}: ${text}` : text);
    }
    if (Object.keys(fieldErrors).length || unplaced.length) {
      const extra = unplaced.length ? ` Also check ${unplaced.slice(0, 2).join(" ")}` : "";
      return { kind: "validation", status, fieldErrors, message: `Some details need another look. Fix the highlighted fields and send again.${extra}` };
    }
    return { kind: "validation", status, fieldErrors, message: `We couldn't read that submission. Please check your answers and try again, or email ${email}.` };
  }

  if (status === 403) {
    return {
      kind: "verification",
      status,
      fieldErrors: {},
      message: serverMessage ?? "We couldn't verify this request. Refresh the page and try again.",
    };
  }
  if (status === 413) {
    return { kind: "too_large", status, fieldErrors: {}, message: "That submission is too large. Shorten any long notes and try again." };
  }
  if (status === 429) {
    return {
      kind: "rate_limit",
      status,
      fieldErrors: {},
      message: `${serverMessage ?? "Too many submissions from this connection."} Please wait a few minutes, or email ${email}.`,
    };
  }
  return {
    kind: "server",
    status,
    fieldErrors: {},
    message: `We couldn't send that just now. Please try again in a moment, or email ${email}.`,
  };
}

export function networkFailure(opts: MapOptions = {}): FormFailure {
  return {
    kind: "network",
    fieldErrors: {},
    message: `We couldn't reach our servers. Check your connection and try again, or email ${opts.contactEmail ?? DEFAULT_EMAIL}.`,
  };
}
