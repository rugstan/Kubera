// Content sniffing for uploads. The browser's Content-Type and the file name
// are attacker-controlled, so finalize reads the first bytes of the stored
// object and checks they really are what was declared. This is a gate against
// mislabelled and polyglot files, not a malware scan (that is workers/scan).

import { EXTENSIONS_BY_TYPE, type AllowedContentType } from "./types";

/** Bytes finalize reads from the start of the object. */
export const SNIFF_BYTES = 8192;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .xls (BIFF in a compound file)
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];

/** First bytes of executables and scripts that must never pass as a CSV (binary formats are caught by their own magic bytes). */
const FORBIDDEN_STARTS: { name: string; bytes: number[] }[] = [
  { name: "ELF executable", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: "Mach-O executable", bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: "Mach-O executable", bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: "script", bytes: [0x23, 0x21] }, // #!
  { name: "Java class", bytes: [0xca, 0xfe, 0xba, 0xbe] },
  // Documents that are mostly ASCII and would otherwise pass a text check.
  { name: "PDF", bytes: PDF },
  { name: "ZIP archive", bytes: ZIP_LOCAL },
];

function startsWith(data: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (data.length < offset + sig.length) return false;
  return sig.every((b, i) => data[offset + i] === b);
}

function ascii(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.subarray(start, start + length));
}

/**
 * An OOXML workbook is a ZIP whose first local entry is a workbook part. The
 * entry name sits at offset 30 (length at offset 26), so the head is enough.
 */
function isOoxmlWorkbook(head: Uint8Array): boolean {
  if (!startsWith(head, ZIP_LOCAL) || head.length < 30) return false;
  const nameLength = head[26]! | (head[27]! << 8);
  if (nameLength === 0 || nameLength > 256 || head.length < 30 + nameLength) return false;
  const name = ascii(head, 30, nameLength);
  return name === "[Content_Types].xml" || name.startsWith("xl/") || name.startsWith("docProps/") || name.startsWith("_rels/") || name === "mimetype";
}

/**
 * Plain-text check for CSV: no NUL bytes, no control characters other than
 * tab/CR/LF/form feed, valid UTF-8 (a BOM is fine), and not a script, HTML or
 * XML document. Only the head is examined; a truncated multi-byte character at
 * the end of the window is tolerated.
 */
export function looksLikeCsv(head: Uint8Array, fullyRead: boolean): boolean {
  if (head.length === 0) return false;
  if (FORBIDDEN_STARTS.some((f) => startsWith(head, f.bytes))) return false;
  for (const b of head) {
    if (b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c) continue;
    if (b < 0x20 || b === 0x7f) return false;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(fullyRead ? head : head.subarray(0, trimPartialUtf8(head)));
  } catch {
    // Legacy exports are often Windows-1252, which is not valid UTF-8 but is still text.
    text = new TextDecoder("latin1").decode(head);
  }
  const lead = text.replace(/^﻿/, "").trimStart().slice(0, 64).toLowerCase();
  if (lead.startsWith("<?xml") || lead.startsWith("<!doctype") || lead.startsWith("<html") || lead.startsWith("<script") || lead.startsWith("<?php") || lead.startsWith("<svg")) return false;
  return true;
}

/** Length of `head` without a trailing, cut-off UTF-8 sequence. */
function trimPartialUtf8(head: Uint8Array): number {
  let end = head.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const b = head[end - back]!;
    if ((b & 0xc0) === 0x80) continue; // continuation byte, keep looking for the lead byte
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (need > back) end -= back;
    break;
  }
  return end;
}

export type SniffResult = { ok: true; detected: string } | { ok: false; reason: string };

/**
 * Verifies that `head` (the first bytes of the object) matches the declared
 * content type. `fullyRead` is true when `head` is the whole file.
 */
export function sniffContent(declared: AllowedContentType, head: Uint8Array, fullyRead: boolean): SniffResult {
  if (head.length === 0) return { ok: false, reason: "The file is empty." };
  switch (declared) {
    case "application/pdf":
      return startsWith(head, PDF) ? { ok: true, detected: "application/pdf" } : { ok: false, reason: "The file is not a valid PDF." };
    case "image/png":
      return startsWith(head, PNG) ? { ok: true, detected: "image/png" } : { ok: false, reason: "The file is not a valid PNG image." };
    case "image/jpeg":
      return startsWith(head, JPEG) ? { ok: true, detected: "image/jpeg" } : { ok: false, reason: "The file is not a valid JPEG image." };
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return isOoxmlWorkbook(head) ? { ok: true, detected: declared } : { ok: false, reason: "The file is not a valid Excel (.xlsx) workbook." };
    case "text/csv":
      return looksLikeCsv(head, fullyRead) ? { ok: true, detected: "text/csv" } : { ok: false, reason: "The file is not plain-text CSV." };
    case "application/vnd.ms-excel":
      // A legacy workbook, or a CSV that Windows browsers label as Excel.
      if (startsWith(head, OLE2)) return { ok: true, detected: "application/vnd.ms-excel" };
      if (looksLikeCsv(head, fullyRead)) return { ok: true, detected: "text/csv" };
      return { ok: false, reason: "The file is not a valid Excel (.xls) workbook or CSV." };
  }
}

/** Lower-cased extension without the dot, or "" when there is none. */
export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 || i === fileName.length - 1 ? "" : fileName.slice(i + 1).toLowerCase();
}

export function extensionMatches(fileName: string, declared: AllowedContentType): boolean {
  return EXTENSIONS_BY_TYPE[declared].includes(fileExtension(fileName));
}

/** File names are stored and shown; keep them to a boring character set and a bounded length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKC").replace(/[^\w.\- ]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[. ]+/, "").trim();
  return (cleaned || "document").slice(0, 120);
}
