// PDF rendering of the executive summary with @react-pdf/renderer (server
// only). Built-in Helvetica and fixed document dates keep the bytes
// deterministic for the same spec.

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ExecutiveSummarySpec } from "./package";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9.5, color: "#1d1d1f", lineHeight: 1.35 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, marginBottom: 3 },
  subtitle: { fontSize: 8.5, color: "#424245", marginBottom: 12 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.75, borderBottomColor: "#d2d2d7" },
  row: { flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f2" },
  label: { width: "50%", paddingRight: 8, color: "#424245" },
  value: { width: "50%", fontFamily: "Helvetica-Bold" },
  para: { marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7.5, color: "#424245", flexDirection: "row", justifyContent: "space-between" },
});

function SummaryPdf({ spec }: { spec: ExecutiveSummarySpec }) {
  const date = new Date(`${spec.asOf}T00:00:00.000Z`);
  return (
    <Document title={spec.title} author="Kubera Commercial, Inc." subject="Loan package executive summary" creator="Kubera Commercial" producer="Kubera Commercial" creationDate={date} modificationDate={date}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{spec.title}</Text>
        <Text style={styles.subtitle}>{spec.subtitle}</Text>
        {spec.sections.map((s) => (
          <View key={s.title} wrap>
            <Text style={styles.h2} minPresenceAhead={40}>
              {s.title}
            </Text>
            {(s.rows ?? []).map((r, i) => (
              <View key={`${r.label}-${i}`} style={styles.row} wrap={false}>
                <Text style={styles.label}>{r.label}</Text>
                <Text style={styles.value}>{r.value}</Text>
              </View>
            ))}
            {(s.paragraphs ?? []).map((p, i) => (
              <Text key={`${i}-${p.slice(0, 20)}`} style={styles.para}>
                {p}
              </Text>
            ))}
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>{spec.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderExecutiveSummaryPdf(spec: ExecutiveSummarySpec): Promise<Uint8Array> {
  const buf = await renderToBuffer(<SummaryPdf spec={spec} />);
  return new Uint8Array(buf);
}
