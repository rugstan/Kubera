import { staffForMutation } from "@/lib/auth/dal";
import { REPORT_CSV_KINDS, reportCsv, type ReportCsvKind } from "@/lib/reporting/csv";
import { parseRange } from "@/lib/reporting/dates";
import { canViewReports } from "../_lib/access";
import { loadBundle } from "../_lib/load";

// Staff-only CSV export of one report. Same access rule as the page: brokers
// and administrators. Never cached.

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function GET(req: Request) {
  const auth = await staffForMutation();
  if (!auth.ok) return Response.json({ error: auth.status === 403 ? "Not allowed" : "Staff sign-in required" }, { status: auth.status, headers: noStore });
  if (!canViewReports(auth.ctx.principal)) return Response.json({ error: "Reports are available to brokers and administrators" }, { status: 403, headers: noStore });

  const url = new URL(req.url);
  const kind = url.searchParams.get("report");
  if (!kind || !(REPORT_CSV_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ error: `report must be one of ${REPORT_CSV_KINDS.join(", ")}` }, { status: 400, headers: noStore });
  }
  const result = await loadBundle(auth.ctx.services, parseRange(url.searchParams.get("range")), new Date());
  if (result.status === "unavailable") return Response.json({ error: "Reports need the database" }, { status: 503, headers: noStore });
  if (result.status === "error") return Response.json({ error: "The report could not be built" }, { status: 500, headers: noStore });

  const { filename, body } = reportCsv(kind as ReportCsvKind, result.bundle);
  return new Response(body, { headers: { ...noStore, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` } });
}
