import { NextResponse } from "next/server";
import { ChecklistError } from "@/lib/checklists/service";
import { guardPost } from "@/lib/security";
import { portalFromRequest } from "../../_lib/request";
import { profileRequestSchema, saveProfileSection } from "../../_lib/profile";

// Borrower portal: save one section of the signed-in principal's profile.

const NO_STORE = { "cache-control": "no-store" };
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: NO_STORE });

const SAFE_ERRORS = new Set(["ChecklistError", "PrincipalInputError", "InvalidSecretError", "PrincipalConcurrencyError"]);

export async function POST(req: Request) {
  const guard = await guardPost(req, { name: "portal-profile", rate: { limit: 60, windowMs: 10 * 60_000 }, turnstile: false, maxBytes: 128_000 });
  if (!guard.ok) return guard.response;
  const portal = await portalFromRequest(req);
  if (!portal.ok) return json(portal.status, { error: portal.error });

  const parsed = profileRequestSchema.safeParse(guard.body);
  if (!parsed.success) return json(400, { error: "Please check the form.", issues: parsed.error.issues.map((i) => ({ path: i.path.filter((p) => p !== "data").join("."), message: i.message })) });

  try {
    const principal = await saveProfileSection(portal.services, portal.session, parsed.data, { ip: guard.ip, userAgent: req.headers.get("user-agent") });
    return json(200, { ok: true, principal });
  } catch (err) {
    if (err instanceof Error && SAFE_ERRORS.has(err.name)) {
      const status = err instanceof ChecklistError ? err.status : err.name === "PrincipalConcurrencyError" ? 409 : 400;
      const issues = (err as { issues?: unknown }).issues;
      return json(status, { error: err.message, ...(Array.isArray(issues) ? { issues } : {}) });
    }
    if (err instanceof Error && err.name === "PiiKeyError") return json(503, { error: "We can't store this securely right now, so nothing was saved. Please try again later or call your advisor." });
    console.error("[portal] profile save failed", err instanceof Error ? err.message : err);
    return json(500, { error: "Something went wrong. Nothing was saved; please try again." });
  }
}
