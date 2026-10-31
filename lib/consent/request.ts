import { z } from "zod";
import { isAllowedOrigin } from "@/lib/security";

// Optional consent metadata a form may send next to its payload:
// `{ consentMeta: { textVersion, page } }`. Both fields are hints only —
// the version must be a known version for the same form (see
// resolveConsentText) and the page is reduced to a same-site path.

const consentMetaSchema = z
  .object({
    textVersion: z.string().trim().max(80).optional(),
    page: z.string().trim().max(512).optional(),
  })
  .optional();

export function readConsentMeta(body: unknown): { textVersion?: string; page?: string } {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).consentMeta : undefined;
  const parsed = consentMetaSchema.safeParse(raw);
  return parsed.success && parsed.data ? parsed.data : {};
}

/** Same-site path of the page the form was on, from the client hint or the Referer. */
export function consentPage(req: Request, hint: string | undefined, fallback: string): string {
  if (hint && /^\/[\w\-./~%?=&]*$/.test(hint)) return hint;
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const u = new URL(ref);
      if (isAllowedOrigin(u.origin)) return u.pathname + u.search;
    } catch {
      // ignore malformed referers
    }
  }
  return fallback;
}
