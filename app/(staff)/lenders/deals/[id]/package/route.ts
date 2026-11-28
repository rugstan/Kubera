// The executive summary preview moved to the deal's lender submission: the
// summary is built from the stored submission profile, not from figures in a
// query string. Old links redirect there; that route checks the staff session.

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return new Response(null, { status: 308, headers: { ...noStore, location: `/deals/${id.toLowerCase()}/submission/summary.pdf` } });
}
