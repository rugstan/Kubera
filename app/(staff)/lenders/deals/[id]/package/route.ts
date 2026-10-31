import { PackageCopyError, buildExecutiveSummary } from "@/lib/agents/lenders/package";
import { lenderRuntime, renderSummaryPdf } from "@/lib/agents/lenders/runtime";
import { currentStaff } from "@/lib/deals/runtime";
import { FormInputError, metricsFromSource } from "../../../_lib/forms";

// Staff-only preview of the executive summary PDF for a deal, from the deal
// record and the metrics in the query string. What a lender receives is the
// copy locked into the package when a submission is approved.

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Staff sign-in required" }, { status: 401, headers: noStore });
  const rt = lenderRuntime();
  if (!rt) return Response.json({ error: "Lender matching storage is not configured" }, { status: 503, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const deal = await rt.desk.store.getDeal(id);
  if (!deal) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  try {
    const metrics = metricsFromSource(new URL(req.url).searchParams, deal.loanAmountCents);
    const spec = buildExecutiveSummary({
      deal: { ...deal, loanAmountCents: metrics.overrides.loanAmountCents ?? deal.loanAmountCents },
      assetClass: metrics.overrides.assetClass ?? null,
      spreads: metrics.spreads,
      asOf: rt.desk.now().toISOString().slice(0, 10),
      advisor: { name: staff.name, email: staff.email, dreLicense: staff.dreLicense },
    });
    const pdf = await renderSummaryPdf(spec);
    return new Response(new Uint8Array(pdf), { headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `inline; filename="executive-summary-preview.pdf"` } });
  } catch (err) {
    if (err instanceof FormInputError || err instanceof PackageCopyError) return Response.json({ error: err.message }, { status: 400, headers: noStore });
    throw err;
  }
}
