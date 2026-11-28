import { currentStaff } from "@/lib/deals/runtime";
import { isTargetStage } from "@/lib/deals/submission/types";
import { SubmissionDataError, getSummaryPdf } from "../_lib/data";

// Staff-only preview of the deal summary PDF at a target stage, built from the
// submission profile. What a lender receives is the copy locked into the
// package when a submission is requested; this preview stores nothing.

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Staff sign-in required" }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const raw = new URL(req.url).searchParams.get("stage") ?? "screen";
  const stage = isTargetStage(raw) ? raw : "screen";
  try {
    const pdf = await getSummaryPdf(id, stage, staff);
    if (!pdf) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
    return new Response(new Uint8Array(pdf), { headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `inline; filename="deal-summary-preview.pdf"` } });
  } catch (err) {
    if (err instanceof SubmissionDataError) return Response.json({ error: err.message }, { status: 400, headers: noStore });
    throw err;
  }
}
