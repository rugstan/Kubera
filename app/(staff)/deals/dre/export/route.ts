import { annualActivityCsv, re853Data, thresholdCsv } from "@/lib/deals/dre";
import { brokerIdentity, currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { annualData, liveThreshold } from "../data";

// Staff-only DRE data exports: threshold counters (CSV), RE 853 data (JSON)
// and annual RE 860 / RE 881 loan activity (CSV).

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Staff sign-in required" }, { status: 401, headers: noStore });
  const rt = dealDeskRuntime();
  if (!rt) return Response.json({ error: "Deal desk storage is not configured" }, { status: 503, headers: noStore });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const csv = (body: string, name: string) => new Response(body, { headers: { ...noStore, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });

  if (kind === "threshold") {
    const c = await liveThreshold(rt);
    return csv(thresholdCsv(c), `dre-threshold-${c.asOf}.csv`);
  }
  if (kind === "RE853") {
    const data = re853Data(await liveThreshold(rt), brokerIdentity());
    if (!data) return Response.json({ error: "The threshold is not met" }, { status: 409, headers: noStore });
    return Response.json(data, { headers: { ...noStore, "content-disposition": `attachment; filename="re853-${data.dateMet}.json"` } });
  }
  if (kind === "RE860" || kind === "RE881") {
    const year = Number(url.searchParams.get("year"));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return Response.json({ error: "year is required" }, { status: 400, headers: noStore });
    const data = await annualData(rt, kind, year, brokerIdentity());
    return csv(annualActivityCsv(data), `${kind.toLowerCase()}-${year}.csv`);
  }
  return Response.json({ error: "kind must be threshold, RE853, RE860 or RE881" }, { status: 400, headers: noStore });
}
