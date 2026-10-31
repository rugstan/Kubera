// Bytes -> ParsedSource. The format comes from the magic bytes first and the
// declared content type second, so a renamed file cannot pick its parser.

import type { Cell, ParsedSource, SourceFormat, Table } from "../types";
import { parseCsv } from "./csv";
import { extractPdfText } from "./pdf";
import { parseXlsx } from "./xlsx";
import { ZipError } from "./zip";

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);

function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  let bad = 0;
  for (const b of head) if (b === 0 || (b < 0x09) || (b > 0x0d && b < 0x20)) bad++;
  return head.length > 0 && bad / head.length < 0.01;
}

export function detectFormat(bytes: Uint8Array, contentType?: string): SourceFormat {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, ZIP_MAGIC)) return "xlsx";
  if (startsWith(bytes, OLE_MAGIC)) throw new UnsupportedDocumentError("legacy .xls workbooks are not supported; save as .xlsx or .csv");
  if (looksLikeText(bytes)) return contentType === "text/plain" ? "text" : contentType === "text/csv" || contentType === "application/vnd.ms-excel" ? "csv" : sniffTextFormat(bytes);
  throw new UnsupportedDocumentError(`unsupported document format${contentType ? ` (${contentType})` : ""}`);
}

function sniffTextFormat(bytes: Uint8Array): SourceFormat {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
  const lines = head.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const commaLines = lines.filter((l) => (l.match(/[,;\t]/g) ?? []).length >= 2).length;
  return lines.length && commaLines / lines.length >= 0.6 ? "csv" : "text";
}

/** Splits plain-text lines into cells on tabs or runs of 2+ spaces, then a trailing amount. */
export function textToTable(text: string, name = "text"): Table {
  const rows: Cell[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trimEnd();
    if (!line.trim()) continue;
    let cells = line.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length === 1) {
      // "Label: value" or "Label ........ 1,234"
      const kv = /^(.{2,80}?)\s*(?::|\.{3,}|–|—)\s*(.+)$/.exec(cells[0]!);
      const trailing = /^(.*?[A-Za-z)].*?)\s+(\(?-?\$?\s?[\d,]+(?:\.\d+)?\)?%?)$/.exec(cells[0]!);
      if (kv) cells = [kv[1]!.trim(), kv[2]!.trim()];
      else if (trailing) cells = [trailing[1]!.trim(), trailing[2]!.trim()];
    } else if (cells.length >= 2 && /:$/.test(cells[0]!)) {
      cells[0] = cells[0]!.replace(/:$/, "").trim();
    }
    rows.push(cells);
  }
  return { name, rows };
}

function tablesToText(tables: Table[]): string {
  return tables
    .map((t) => `# ${t.name}\n${t.rows.map((r) => r.map((c) => (c === null ? "" : String(c))).join("\t")).join("\n")}`)
    .join("\n\n");
}

export function parseDocument(bytes: Uint8Array, contentType?: string): ParsedSource {
  const format = detectFormat(bytes, contentType);
  if (format === "pdf") {
    const pdf = extractPdfText(bytes);
    const warnings = pdf.quality < 0.5 ? ["pdf_text_layer_unreadable"] : [];
    return { format, tables: pdf.text ? [textToTable(pdf.text, "pdf")] : [], text: pdf.text, textQuality: pdf.quality, pages: pdf.pages, warnings };
  }
  if (format === "xlsx") {
    let tables: Table[];
    try {
      tables = parseXlsx(bytes);
    } catch (err) {
      if (err instanceof ZipError) throw new UnsupportedDocumentError(`unreadable workbook: ${err.message}`);
      throw err;
    }
    return { format, tables, text: tablesToText(tables), textQuality: 1, warnings: [] };
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  if (format === "csv") {
    const table = { name: "csv", rows: parseCsv(text) };
    return { format, tables: [table], text: tablesToText([table]), textQuality: 1, warnings: [] };
  }
  return { format, tables: [textToTable(text)], text, textQuality: 1, warnings: [] };
}
