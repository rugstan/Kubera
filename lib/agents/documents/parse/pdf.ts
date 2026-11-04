// Best-effort PDF text-layer reader. It decodes content streams (Flate or
// uncompressed), walks the text operators (Tj, TJ, ', ", Td, TD, Tm, T*) and
// rebuilds lines, separating columns with a tab. It does not map CID fonts:
// a PDF whose text is glyph ids (or a scan with no text at all) gets a low
// `quality` score, and the pipeline then sends the PDF itself to Claude (or to
// NeMo Retriever) instead of trusting this text.
//
// Also a tiny writer that builds valid single-font PDFs for test fixtures.

import { deflateSync, inflateSync } from "node:zlib";

export type PdfText = { text: string; pages: number; quality: number; streams: number };

const MAX_STREAM_BYTES = 20 * 1024 * 1024;

function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return s;
}

/** Decoded content streams (skips images, fonts and embedded files). */
export function contentStreams(bytes: Uint8Array): string[] {
  const src = latin1(bytes);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const dictStart = src.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 && m.index - dictStart < 2_000 ? src.slice(dictStart, m.index) : "";
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    if (/\/Subtype\s*\/Image|\/FontFile|\/Length1|\/Type\s*\/(XRef|ObjStm|EmbeddedFile|Metadata)/.test(dict)) continue;
    let data = bytes.subarray(start, end);
    // Trim the EOL before "endstream".
    while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) data = data.subarray(0, data.length - 1);
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = new Uint8Array(inflateSync(data, { maxOutputLength: MAX_STREAM_BYTES }));
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) {
      continue; // DCT, LZW, ASCII85 … not text we can read
    }
    out.push(latin1(data));
  }
  return out;
}

type Token = { t: "str"; v: string } | { t: "num"; v: number } | { t: "arr"; v: Token[] } | { t: "op"; v: string } | { t: "name"; v: string };

function readLiteral(s: string, i: number): [string, number] {
  // s[i] === "("
  let depth = 1;
  let out = "";
  i++;
  while (i < s.length && depth > 0) {
    const ch = s[i]!;
    if (ch === "\\") {
      const n = s[i + 1] ?? "";
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (map[n] !== undefined) {
        out += map[n];
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
      } else if (n === "\r" || n === "\n") {
        i += n === "\r" && s[i + 2] === "\n" ? 3 : 2;
      } else {
        out += n;
        i += 2;
      }
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    out += ch;
    i++;
  }
  return [out, i];
}

function tokenize(s: string): Token[] {
  const stack: Token[][] = [[]];
  let i = 0;
  const push = (t: Token) => stack[stack.length - 1]!.push(t);
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    if (ch === "(") {
      const [v, next] = readLiteral(s, i);
      push({ t: "str", v });
      i = next;
      continue;
    }
    if (ch === "<" && s[i + 1] === "<") {
      i += 2;
      continue;
    }
    if (ch === ">" && s[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (ch === "<") {
      const end = s.indexOf(">", i);
      const hex = s.slice(i + 1, end < 0 ? s.length : end).replace(/\s+/g, "");
      let v = "";
      for (let k = 0; k < hex.length; k += 2) v += String.fromCharCode(parseInt((hex.slice(k, k + 2) + "0").slice(0, 2), 16));
      push({ t: "str", v });
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (ch === "[") {
      stack.push([]);
      i++;
      continue;
    }
    if (ch === "]") {
      const arr = stack.length > 1 ? stack.pop()! : [];
      push({ t: "arr", v: arr });
      i++;
      continue;
    }
    if (ch === "/") {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 128))!;
      push({ t: "name", v: m[0] });
      i += m[0].length;
      continue;
    }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
    if (num) {
      push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const op = /^[A-Za-z'"*]+/.exec(s.slice(i, i + 16));
    if (op) {
      push({ t: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    i++;
  }
  return stack[0]!;
}

/** Rebuilds text lines from one content stream. */
export function textFromContent(content: string): string {
  const tokens = tokenize(content);
  const lines: string[] = [];
  let line = "";
  let operands: Token[] = [];
  let y: number | null = null;
  let pendingGap = false;
  const flush = () => {
    if (line.trim()) lines.push(line.replace(/[ \t]+$/g, ""));
    line = "";
    pendingGap = false;
  };
  const emit = (s: string) => {
    if (pendingGap && line) line += "\t";
    pendingGap = false;
    line += s;
  };
  const moveTo = (newY: number | null, dx: number) => {
    if (newY !== null && y !== null && Math.abs(newY - y) > 1) flush();
    else if (dx > 1) pendingGap = true;
    if (newY !== null) y = newY;
  };
  for (const tok of tokens) {
    if (tok.t !== "op") {
      operands.push(tok);
      continue;
    }
    const nums = operands.filter((o): o is { t: "num"; v: number } => o.t === "num").map((o) => o.v);
    switch (tok.v) {
      case "BT":
        y = y ?? null;
        break;
      case "Td":
      case "TD": {
        const [dx = 0, dy = 0] = nums.slice(-2);
        moveTo(y === null ? dy : y + dy, dx);
        if (y === null) y = dy;
        break;
      }
      case "Tm": {
        const f = nums.slice(-6);
        if (f.length === 6) moveTo(f[5]!, 2);
        break;
      }
      case "T*":
        flush();
        break;
      case "Tj":
      case "'":
      case '"': {
        if (tok.v !== "Tj") flush();
        const s = [...operands].reverse().find((o) => o.t === "str");
        if (s && s.t === "str") emit(s.v);
        break;
      }
      case "TJ": {
        const arr = [...operands].reverse().find((o) => o.t === "arr");
        if (arr && arr.t === "arr") {
          let piece = "";
          for (const el of arr.v) {
            if (el.t === "str") piece += el.v;
            else if (el.t === "num" && el.v < -180) piece += " ";
          }
          emit(piece);
        }
        break;
      }
      case "ET":
        break;
      default:
        break;
    }
    operands = [];
  }
  flush();
  return lines.join("\n");
}

/** 0..1: share of characters that are printable text, discounted when there is very little of it. */
export function textQuality(text: string, pages: number): number {
  const chars = text.replace(/\s/g, "");
  if (!chars.length) return 0;
  const good = chars.replace(/[^A-Za-z0-9$%.,;:()\-/&'#@*+]/g, "").length;
  const ratio = good / chars.length;
  const words = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
  const density = Math.min(1, words / Math.max(8, 8 * pages));
  return Math.round(ratio * density * 1000) / 1000;
}

export function pdfPageCount(bytes: Uint8Array): number {
  const src = latin1(bytes.length > 4 * 1024 * 1024 ? bytes.subarray(0, 4 * 1024 * 1024) : bytes);
  return (src.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length || 1;
}

export function extractPdfText(bytes: Uint8Array): PdfText {
  const streams = contentStreams(bytes);
  const text = streams
    .map(textFromContent)
    .filter((t) => t.trim())
    .join("\n");
  const pages = pdfPageCount(bytes);
  return { text, pages, quality: textQuality(text, pages), streams: streams.length };
}

// --- writer (fixtures) -------------------------------------------------------------------

const escPdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * Builds a one-page PDF with Helvetica text. Each line is an array of columns
 * placed at fixed x offsets. `compress` deflates the content stream.
 */
export function buildPdf(lines: string[][], opts: { compress?: boolean; columnWidth?: number } = {}): Uint8Array {
  const colW = opts.columnWidth ?? 220;
  let content = "BT\n/F1 10 Tf\n";
  let y = 760;
  content += `1 0 0 1 40 ${y} Tm\n`;
  lines.forEach((cols, li) => {
    if (li > 0) {
      y -= 14;
      content += `1 0 0 1 40 ${y} Tm\n`;
    }
    cols.forEach((c, ci) => {
      if (ci > 0) content += `${colW} 0 Td\n`;
      content += `(${escPdf(c)}) Tj\n`;
    });
  });
  content += "ET\n";
  const raw = new TextEncoder().encode(content);
  const body = opts.compress ? new Uint8Array(deflateSync(raw)) : raw;
  const objs: (string | Uint8Array)[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"],
    [`<< /Length ${body.length}${opts.compress ? " /Filter /FlateDecode" : ""} >>\nstream\n`, body, "\nendstream"],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ];
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n")];
  const offsets: number[] = [];
  let pos = parts[0]!.length;
  objs.forEach((obj, i) => {
    offsets.push(pos);
    const chunk = [enc.encode(`${i + 1} 0 obj\n`), ...obj.map((p) => (typeof p === "string" ? enc.encode(p) : p)), enc.encode("\nendobj\n")];
    for (const c of chunk) {
      parts.push(c);
      pos += c.length;
    }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
