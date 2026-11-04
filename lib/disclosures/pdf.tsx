// PDF rendering of a disclosure with @react-pdf/renderer (server only; keep
// this module out of route bundles that do not render PDFs). Uses the built-in
// Helvetica family so output is deterministic and needs no font downloads.

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { DocumentSpec } from "./mlds";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9.5, color: "#1d1d1f", lineHeight: 1.35 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 14, marginBottom: 3 },
  subtitle: { fontSize: 8.5, color: "#424245", marginBottom: 10 },
  draft: { borderWidth: 1.5, borderColor: "#b42318", color: "#b42318", fontFamily: "Helvetica-Bold", padding: 6, marginBottom: 10, textTransform: "uppercase" },
  watermark: { position: "absolute", top: 360, left: 90, fontSize: 64, color: "#b42318", opacity: 0.12, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.75, borderBottomColor: "#d2d2d7" },
  row: { flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f2" },
  label: { width: "56%", paddingRight: 8 },
  value: { width: "44%" },
  bold: { fontFamily: "Helvetica-Bold" },
  para: { marginTop: 4 },
  sig: { marginTop: 22, width: 300 },
  sigLine: { borderBottomWidth: 0.75, borderBottomColor: "#1d1d1f", height: 20, marginBottom: 3 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7.5, color: "#424245", flexDirection: "row", justifyContent: "space-between" },
});

function DisclosurePdf({ doc }: { doc: DocumentSpec }) {
  return (
    <Document title={doc.title} author="Corin Commercial, Inc." subject={doc.subtitle} creator="Corin Commercial" producer="Corin Commercial">
      <Page size="LETTER" style={styles.page}>
        {doc.draft ? (
          <Text style={styles.watermark} fixed>
            DRAFT
          </Text>
        ) : null}
        <Text style={styles.title}>{doc.title}</Text>
        <Text style={styles.subtitle}>{doc.subtitle}</Text>
        {doc.notice.map((n) => (
          <Text key={n} style={styles.draft}>
            {n}
          </Text>
        ))}
        {doc.sections.map((s) => (
          <View key={s.title} wrap>
            <Text style={styles.h2} minPresenceAhead={40}>
              {s.title}
            </Text>
            {(s.rows ?? []).map((r, i) => (
              <View key={`${r.label}-${i}`} style={styles.row} wrap={false}>
                <Text style={r.emphasis ? [styles.label, styles.bold] : styles.label}>{r.label}</Text>
                <Text style={r.emphasis ? [styles.value, styles.bold] : styles.value}>{r.value}</Text>
              </View>
            ))}
            {(s.paragraphs ?? []).map((p) => (
              <Text key={p} style={styles.para}>
                {p}
              </Text>
            ))}
          </View>
        ))}
        <Text style={styles.h2} minPresenceAhead={60}>
          Signatures
        </Text>
        {doc.signatureLines.map((s, i) => (
          <View key={`${s.name}-${i}`} style={styles.sig} wrap={false}>
            <View style={styles.sigLine} />
            <Text>
              {s.label}: {s.name}
              {s.detail ? ` (${s.detail})` : ""}
            </Text>
            <Text>Date: ____________</Text>
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>{doc.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Render a disclosure to PDF bytes. */
export async function renderDisclosurePdf(doc: DocumentSpec): Promise<Uint8Array> {
  const buf = await renderToBuffer(<DisclosurePdf doc={doc} />);
  return new Uint8Array(buf);
}
