// XLSX (Office Open XML spreadsheet) reader: workbook sheet order, shared
// strings, inline strings, numbers and booleans. Formulas are read as their
// cached values. Dates stay Excel serial numbers; the value parsers convert
// them where a date is expected. Also a small writer for test fixtures.

import type { Cell, Table } from "../types";
import { readZip, writeZip, ZipError } from "./zip";

const decoder = new TextDecoder("utf-8");

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlEntities(m[1]!) : undefined;
}

/** Text of every <t> inside an element (rich-text runs concatenated). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXmlEntities(m[1]!);
  return out;
}

export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
}

const MAX_ROWS = 20_000;
const MAX_COLS = 200;

function parseSheet(xml: string, strings: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[1]!, "r") ?? rows.length + 1) - 1;
    if (r >= MAX_ROWS) break;
    const row: Cell[] = [];
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attr(tag, "r");
      const col = ref ? columnIndex(ref) : row.length;
      if (col >= MAX_COLS) continue;
      const type = attr(tag, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell: Cell = null;
      if (type === "s" && v !== undefined) cell = strings[Number(v)] ?? null;
      else if (type === "inlineStr") cell = textOf(body);
      else if (type === "str" && v !== undefined) cell = decodeXmlEntities(v);
      else if (type === "b" && v !== undefined) cell = v === "1" ? "TRUE" : "FALSE";
      else if (type === "e") cell = null;
      else if (v !== undefined) {
        const n = Number(v);
        cell = Number.isFinite(n) ? n : decodeXmlEntities(v);
      }
      if (typeof cell === "string" && !cell.trim()) cell = null;
      while (row.length < col) row.push(null);
      row[col] = cell;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => c === null)) rows.pop();
  return rows;
}

/** Reads every worksheet in workbook order. Throws ZipError on a corrupt or oversized archive. */
export function parseXlsx(bytes: Uint8Array): Table[] {
  const files = readZip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const text = (n: string) => {
    const b = files.get(n);
    return b ? decoder.decode(b) : undefined;
  };
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new ZipError("not an XLSX workbook (xl/workbook.xml missing)");
  const rels = new Map<string, string>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const target = attr(m[1]!, "Target");
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const strings = sharedStrings(text("xl/sharedStrings.xml"));
  const tables: Table[] = [];
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)];
  sheets.forEach((m, i) => {
    const name = attr(m[1]!, "name") ?? `Sheet${i + 1}`;
    const rid = attr(m[1]!, "r:id");
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${i + 1}.xml`;
    const xml = text(path);
    if (xml) tables.push({ name, rows: parseSheet(xml, strings) });
  });
  return tables;
}

// --- writer (fixtures) -------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colRef(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Builds a minimal XLSX workbook. Strings go to the shared-string table, numbers inline. */
export function buildXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const sid = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((c, ci) => {
            const ref = `${colRef(ci)}${r + 1}`;
            if (c === null) return "";
            if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
            return `<c r="${ref}" t="s"><v>${sid(c)}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}</Relationships>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
    .join("")}</sst>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  return writeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    { name: "xl/sharedStrings.xml", data: sst },
    ...sheetXml.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
  ]);
}
