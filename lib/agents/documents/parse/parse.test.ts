import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseCsv, sniffDelimiter } from "./csv";
import { detectFormat, parseDocument, textToTable, UnsupportedDocumentError } from "./index";
import { buildPdf, extractPdfText, textFromContent, textQuality } from "./pdf";
import { buildXlsx, columnIndex, decodeXmlEntities, parseXlsx } from "./xlsx";
import { crc32, listZipEntries, readZip, writeZip, ZipError } from "./zip";

describe("CSV", () => {
  it("handles quotes, doubled quotes, embedded newlines, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,"b, c","say ""hi"""\r\n"multi\nline",2,\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["multi\nline", "2", null],
    ]);
  });
  it("sniffs semicolon and tab delimiters", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("ZIP / XLSX", () => {
  it("round-trips a workbook with shared strings, numbers and gaps", () => {
    const bytes = buildXlsx([
      { name: "One", rows: [["Label", "Amount"], ["Rent & fees", 1200.5], [null, null, "far"]] },
      { name: "Two", rows: [["x"]] },
    ]);
    const tables = parseXlsx(bytes);
    expect(tables.map((t) => t.name)).toEqual(["One", "Two"]);
    expect(tables[0]!.rows).toEqual([["Label", "Amount"], ["Rent & fees", 1200.5], [null, null, "far"]]);
  });
  it("reads inline strings and booleans", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="C1" t="b"><v>1</v></c></row></sheetData></worksheet>`;
    const bytes = writeZip([
      { name: "xl/workbook.xml", data: `<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>` },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
    expect(parseXlsx(bytes)[0]!.rows).toEqual([["Hello", null, "TRUE"]]);
  });
  it("refuses archives that inflate past the budget (zip bombs)", () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    const bytes = writeZip([{ name: "xl/worksheets/sheet1.xml", data: big }]);
    expect(() => readZip(bytes, () => true, 1024 * 1024)).toThrow(ZipError);
  });
  it("rejects non-zip input and workbooks without a workbook part", () => {
    expect(() => listZipEntries(new Uint8Array([1, 2, 3]))).toThrow(ZipError);
    expect(() => parseXlsx(writeZip([{ name: "foo.txt", data: "x" }]))).toThrow(/workbook/);
  });
  it("helpers", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("AB12")).toBe(27);
    expect(decodeXmlEntities("a &amp; b &#x41; &#66; &lt;")).toBe("a & b A B <");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(deflateRawSync(Buffer.from("x")).length).toBeGreaterThan(0);
  });
});

describe("PDF text layer", () => {
  it("rebuilds lines and columns from Tm / Td / Tj, compressed or not", () => {
    for (const compress of [false, true]) {
      const pdf = buildPdf([["Net Operating Income", "1,023,200"], ["Total (net)", "5"]], { compress });
      const t = extractPdfText(pdf);
      expect(t.text).toBe("Net Operating Income\t1,023,200\nTotal (net)\t5");
      expect(t.pages).toBe(1);
    }
  });
  it("reads TJ arrays, escapes and T*", () => {
    expect(textFromContent("BT /F1 9 Tf 10 700 Td [(Gross )-50(Rent)] TJ T* (Line \\(two\\)) Tj ET")).toBe("Gross Rent\nLine (two)");
    expect(textFromContent("BT 0 0 Td [(A)-400(B)] TJ ET")).toBe("A B");
  });
  it("scores scanned or glyph-id text as unreadable", () => {
    expect(textQuality("", 1)).toBe(0);
    expect(textQuality("\u0001\u0002\u0003\u0004\u0005", 1)).toBeLessThan(0.2);
    expect(textQuality("Gross potential rent 960,000 vacancy loss 38,400 other income 36,000 total income", 1)).toBeGreaterThan(0.8);
    const scanned = buildPdf([[""]]);
    expect(parseDocument(scanned).textQuality).toBe(0);
    expect(parseDocument(scanned).warnings).toContain("pdf_text_layer_unreadable");
  });
});

describe("format detection and text tables", () => {
  it("decides by magic bytes, not by the declared type", () => {
    expect(detectFormat(buildPdf([["x"]]), "text/csv")).toBe("pdf");
    expect(detectFormat(buildXlsx([{ name: "a", rows: [["x"]] }]), "application/pdf")).toBe("xlsx");
    expect(detectFormat(new TextEncoder().encode("a,b,c\n1,2,3\n4,5,6"))).toBe("csv");
    expect(detectFormat(new TextEncoder().encode("Loan Amount: $1\nRate: 5%"), "text/plain")).toBe("text");
    expect(() => detectFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(UnsupportedDocumentError);
    expect(() => detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toThrow(UnsupportedDocumentError);
  });
  it("splits label/value lines", () => {
    expect(textToTable("Loan Amount: $12,500,000\nReal estate taxes ..... 96,000\nRepairs  40,000\nTaxes 2025 12,000").rows).toEqual([
      ["Loan Amount", "$12,500,000"],
      ["Real estate taxes", "96,000"],
      ["Repairs", "40,000"],
      ["Taxes 2025", "12,000"],
    ]);
  });
});
