// PDF rendering of the lender-ready deal summary with @react-pdf/renderer
// (server only). Built-in Helvetica and fixed document dates keep the bytes
// deterministic for the same spec.

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { DealSummarySpec } from "@/lib/deals/submission/types";

// The deal summary (lib/deals/submission/summary.ts): headline tiles, rows
// with a source column, and tables. Fixed document dates from the spec's
// as-of date and built-in fonts only.

const deal = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 34, fontFamily: "Helvetica", fontSize: 7.5, color: "#1d1d1f", lineHeight: 1.22 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 13, lineHeight: 1.35, marginBottom: 3 },
  subtitle: { fontSize: 7.5, color: "#424245", marginBottom: 6 },
  tiles: { flexDirection: "row", flexWrap: "wrap", marginBottom: 2 },
  tile: { width: "16.66%", paddingVertical: 3, paddingHorizontal: 5, borderWidth: 0.5, borderColor: "#d2d2d7" },
  tileLabel: { fontSize: 6.5, color: "#424245" },
  tileValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginTop: 6, marginBottom: 2, paddingBottom: 1, borderBottomWidth: 0.75, borderBottomColor: "#d2d2d7" },
  row: { flexDirection: "row", paddingVertical: 0.75, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f2" },
  label: { width: "30%", paddingRight: 6, color: "#424245" },
  value: { width: "48%", paddingRight: 6, fontFamily: "Helvetica-Bold" },
  source: { width: "22%", fontSize: 6.5, color: "#6e6e73" },
  para: { marginTop: 2 },
  tableRow: { flexDirection: "row", paddingVertical: 0.75, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f2" },
  tableHead: { flexDirection: "row", paddingVertical: 0.75, borderBottomWidth: 0.75, borderBottomColor: "#d2d2d7" },
  cell: { flex: 1, paddingRight: 6 },
  headCell: { flex: 1, paddingRight: 6, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 20, left: 38, right: 38, fontSize: 7, color: "#424245", flexDirection: "row", justifyContent: "space-between" },
  footerText: { width: "88%" },
});

function DealSummaryDocument({ spec }: { spec: DealSummarySpec }) {
  const date = new Date(`${spec.asOf}T00:00:00.000Z`);
  return (
    <Document title={spec.title} author="Corin Commercial, Inc." subject="Loan request summary" creator="Corin Commercial" producer="Corin Commercial" creationDate={date} modificationDate={date}>
      <Page size="LETTER" style={deal.page}>
        <Text style={deal.title}>{spec.title}</Text>
        <Text style={deal.subtitle}>{spec.subtitle}</Text>
        {spec.headline.length > 0 && (
          <View style={deal.tiles}>
            {spec.headline.map((h, i) => (
              <View key={`${h.label}-${i}`} style={deal.tile} wrap={false}>
                <Text style={deal.tileLabel}>{h.label}</Text>
                <Text style={deal.tileValue}>{h.value}</Text>
              </View>
            ))}
          </View>
        )}
        {spec.sections.map((s, si) => (
          <View key={`${s.title}-${si}`} wrap>
            <Text style={deal.h2} minPresenceAhead={30}>
              {s.title}
            </Text>
            {(s.rows ?? []).map((r, i) => (
              <View key={`${r.label}-${i}`} style={deal.row} wrap={false}>
                <Text style={deal.label}>{r.label}</Text>
                <Text style={deal.value}>{r.value}</Text>
                <Text style={deal.source}>{r.source ?? ""}</Text>
              </View>
            ))}
            {s.table && (
              <View>
                <View style={deal.tableHead} wrap={false}>
                  {s.table.head.map((h, i) => (
                    <Text key={`h-${i}`} style={deal.headCell}>
                      {h}
                    </Text>
                  ))}
                </View>
                {s.table.rows.map((cells, ri) => (
                  <View key={`r-${ri}`} style={deal.tableRow} wrap={false}>
                    {cells.map((c, ci) => (
                      <Text key={`c-${ci}`} style={deal.cell}>
                        {c}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            )}
            {(s.paragraphs ?? []).map((p, i) => (
              <Text key={`${i}-${p.slice(0, 20)}`} style={deal.para}>
                {p}
              </Text>
            ))}
          </View>
        ))}
        <View style={deal.footer} fixed>
          <Text style={deal.footerText}>{spec.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// The built-in Helvetica covers WinAnsi only; these characters would print as
// the wrong glyph ("−" as a blank, "Σ" as "£"), so they are spelled out.
const PDF_CHARS: Record<string, string> = { "−": "-", "Σ": "sum of ", "≥": ">=", "≤": "<=", "→": "->", "≈": "~", " ": " ", " ": " ", " ": " " };
const pdfText = (s: string) => s.replace(/[−Σ≥≤→≈   ]/g, (c) => PDF_CHARS[c] ?? c);

function pdfSafe<T>(v: T): T {
  if (typeof v === "string") return pdfText(v) as T;
  if (Array.isArray(v)) return v.map(pdfSafe) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pdfSafe(x)])) as T;
  return v;
}

/** The deal summary PDF added to the locked manifest as DEAL_SUMMARY; the same spec gives the same bytes. */
export async function renderDealSummaryPdf(spec: DealSummarySpec): Promise<Uint8Array> {
  const buf = await renderToBuffer(<DealSummaryDocument spec={pdfSafe(spec)} />);
  return new Uint8Array(buf);
}
