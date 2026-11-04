// RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF, embedded newlines),
// with delimiter sniffing for semicolon- and tab-separated exports.

import type { Cell } from "../types";

export function sniffDelimiter(text: string): "," | ";" | "\t" {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const counts: [("," | ";" | "\t"), number][] = [
    [",", count(",")],
    [";", count(";")],
    ["\t", count("\t")],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ",";
}

export function parseCsv(text: string, delimiter: string = sniffDelimiter(text)): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");
  const push = () => {
    const v = field.trim();
    row.push(v === "" ? null : v);
    field = "";
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
      i++;
      continue;
    }
    if (ch === delimiter) {
      push();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      push();
      rows.push(row);
      row = [];
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    push();
    rows.push(row);
  }
  // Drop trailing empty rows.
  while (rows.length && rows[rows.length - 1]!.every((c) => c === null)) rows.pop();
  return rows;
}
