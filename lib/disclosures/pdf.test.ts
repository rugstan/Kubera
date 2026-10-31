import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { funderDocument } from "./funder";
import { buildMlds, mldsDocument } from "./mlds";
import { renderDisclosurePdf } from "./pdf";
import { sampleFunderInput, sampleMldsInput } from "./test-fixtures";

/** Decompress every Flate stream so text operators can be inspected. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const out: string[] = [raw.toString("latin1")];
  let i = 0;
  while ((i = raw.indexOf("stream", i)) !== -1) {
    let start = i + "stream".length;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    try {
      out.push(inflateSync(raw.subarray(start, end)).toString("latin1"));
    } catch {
      // not a Flate stream
    }
    i = end + "endstream".length;
  }
  return out.join("\n");
}

/** Text drawn with Helvetica's standard encoding: collect the hex/literal strings inside TJ/Tj operators. */
function drawnText(bytes: Uint8Array): string {
  const text = pdfText(bytes);
  const hex = [...text.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1] as string, "hex").toString("latin1"));
  const literal = [...text.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((m) => m[1] as string);
  return [...hex, ...literal].join("");
}

describe("disclosure PDF", () => {
  it("renders a sample MLDS", async () => {
    const pdf = await renderDisclosurePdf(mldsDocument(buildMlds(sampleMldsInput, { approved: false })));
    const head = Buffer.from(pdf.subarray(0, 5)).toString("latin1");
    expect(head).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4_000);
    const raw = pdfText(pdf);
    expect(raw).toMatch(/\/Type\s*\/Page\b/);
    expect(raw).toContain("%%EOF");
    const drawn = drawnText(pdf);
    for (const s of ["RE 882", "DRAFT", "Principal amount", "8,500,000.00", "broker-controlled funds", "Signatures"]) expect(drawn).toContain(s);
  }, 30_000);

  it("renders the funder disclosure", async () => {
    const pdf = await renderDisclosurePdf(funderDocument(sampleFunderInput, { approved: true }));
    const drawn = drawnText(pdf);
    expect(drawn).toContain("Lender of record");
    expect(drawn).toContain("does not receive, hold, transfer or disburse");
    expect(drawn).not.toContain("DRAFT");
  }, 30_000);
});
