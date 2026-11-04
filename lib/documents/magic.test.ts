import { describe, expect, it } from "vitest";
import { extensionMatches, fileExtension, looksLikeCsv, sanitizeFileName, sniffContent } from "./magic";
import { CSV_BYTES, PDF_BYTES, PNG_BYTES, xlsxBytes } from "./testing";

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("sniffContent", () => {
  it("accepts real files of each declared type", () => {
    expect(sniffContent("application/pdf", PDF_BYTES, true)).toEqual({ ok: true, detected: "application/pdf" });
    expect(sniffContent("image/png", PNG_BYTES, true)).toEqual({ ok: true, detected: "image/png" });
    expect(sniffContent("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16), true)).toEqual({ ok: true, detected: "image/jpeg" });
    expect(sniffContent(XLSX, xlsxBytes(), false)).toEqual({ ok: true, detected: XLSX });
    expect(sniffContent("text/csv", CSV_BYTES, true)).toEqual({ ok: true, detected: "text/csv" });
    expect(sniffContent("application/vnd.ms-excel", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0), false)).toEqual({ ok: true, detected: "application/vnd.ms-excel" });
  });

  it("accepts a CSV that a Windows browser labelled application/vnd.ms-excel", () => {
    expect(sniffContent("application/vnd.ms-excel", CSV_BYTES, true)).toEqual({ ok: true, detected: "text/csv" });
  });

  it("rejects the wrong magic bytes for the declared type", () => {
    expect(sniffContent("application/pdf", PNG_BYTES, true).ok).toBe(false);
    expect(sniffContent("image/png", PDF_BYTES, true).ok).toBe(false);
    expect(sniffContent("image/jpeg", PNG_BYTES, true).ok).toBe(false);
    expect(sniffContent(XLSX, PDF_BYTES, true).ok).toBe(false);
    expect(sniffContent("application/vnd.ms-excel", PDF_BYTES, true).ok).toBe(false);
  });

  it("rejects a zip that is not a workbook, and an empty file", () => {
    const zip = new Uint8Array(40);
    zip.set([0x50, 0x4b, 0x03, 0x04], 0);
    zip[26] = 8;
    zip.set(text("evil.exe"), 30);
    expect(sniffContent(XLSX, zip, true).ok).toBe(false);
    expect(sniffContent("application/pdf", new Uint8Array(0), true)).toEqual({ ok: false, reason: "The file is empty." });
  });

  it("rejects executables and scripts disguised as CSV", () => {
    expect(sniffContent("text/csv", bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0), true).ok).toBe(false);
    expect(sniffContent("text/csv", text("#!/bin/sh\nrm -rf /\n"), true).ok).toBe(false);
    expect(sniffContent("text/csv", text("<html><script>alert(1)</script></html>"), true).ok).toBe(false);
    expect(sniffContent("text/csv", text("<?xml version=\"1.0\"?><svg/>"), true).ok).toBe(false);
  });

  it("rejects binary data posing as CSV (NUL and control bytes)", () => {
    expect(sniffContent("text/csv", bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0), true).ok).toBe(false);
    expect(sniffContent("text/csv", PNG_BYTES, true).ok).toBe(false);
    expect(sniffContent("text/csv", PDF_BYTES, true).ok).toBe(false); // mostly ASCII, but a PDF is not a CSV
    expect(sniffContent("text/csv", bytes(0x50, 0x4b, 0x03, 0x04, 0x41, 0x42), true).ok).toBe(false);
  });
});

describe("looksLikeCsv", () => {
  it("tolerates a BOM, Windows-1252 text, and a multi-byte character cut off at the end of the window", () => {
    expect(looksLikeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...text("a,b\n1,2\n")]), true)).toBe(true);
    expect(looksLikeCsv(new Uint8Array([...text("name,city\nJos"), 0xe9, ...text(",Paris\n")]), true)).toBe(true);
    const cut = new Uint8Array([...text("a,b\n"), 0xe2, 0x82]); // start of a euro sign
    expect(looksLikeCsv(cut, false)).toBe(true);
  });
});

describe("file names", () => {
  it("matches extensions to declared types", () => {
    expect(extensionMatches("t12.PDF", "application/pdf")).toBe(true);
    expect(extensionMatches("t12.exe", "application/pdf")).toBe(false);
    expect(extensionMatches("rent-roll.csv", "application/vnd.ms-excel")).toBe(true);
    expect(extensionMatches("noextension", "text/csv")).toBe(false);
    expect(fileExtension("a.b.xlsx")).toBe("xlsx");
    expect(fileExtension("trailingdot.")).toBe("");
  });

  it("sanitizes names for storage and display", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\temp\\T-12 2025.pdf")).toBe("T-12 2025.pdf");
    expect(sanitizeFileName("a<b>|c.pdf")).toBe("a_b_c.pdf");
    expect(sanitizeFileName("...")).toBe("document");
    expect(sanitizeFileName("x".repeat(300) + ".pdf").length).toBe(120);
  });
});
