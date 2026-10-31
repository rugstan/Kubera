import { form159Document } from "@/lib/deals/form159";
import { currentStaff, dealDeskRuntime, renderPdf } from "@/lib/deals/runtime";

// Staff-only PDF of a stored Form 159 version, rendered from its saved data.

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; formId: string }> }) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Staff sign-in required" }, { status: 401, headers: noStore });
  const rt = dealDeskRuntime();
  if (!rt) return Response.json({ error: "Deal desk storage is not configured" }, { status: 503, headers: noStore });
  const { id, formId } = await ctx.params;
  const form = await rt.store.getForm159(formId);
  if (!form || form.dealId !== id) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const pdf = await renderPdf(form159Document(form.data, { draft: form.draft }));
  return new Response(new Uint8Array(pdf), {
    headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `inline; filename="sba-form-159-v${form.version}.pdf"` },
  });
}
