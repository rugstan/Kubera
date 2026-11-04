// Minimal ZIP reader (and writer, for test fixtures) for XLSX workbooks.
// Reads the central directory, supports stored and deflated entries, and
// refuses archives that would inflate past a byte budget (zip bombs).

import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const decoder = new TextDecoder("utf-8");

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not a zip archive (no end of central directory)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > 5_000) throw new ZipError("too many zip entries");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CEN_SIG) throw new ZipError("corrupt central directory");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  const dv = view(bytes);
  if (entry.offset + 30 > bytes.length || dv.getUint32(entry.offset, true) !== LOC_SIG) throw new ZipError(`corrupt local header for ${entry.name}`);
  if (entry.size > maxBytes) throw new ZipError(`zip entry ${entry.name} is larger than the budget`);
  const nameLen = dv.getUint16(entry.offset + 26, true);
  const extraLen = dv.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const out = inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes) });
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  throw new ZipError(`unsupported zip compression method ${entry.method}`);
}

/** Reads named entries (missing ones are omitted). `budget` caps total inflated bytes. */
export function readZip(bytes: Uint8Array, wanted: (name: string) => boolean, budget = 64 * 1024 * 1024): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let used = 0;
  for (const entry of listZipEntries(bytes)) {
    if (!wanted(entry.name)) continue;
    const data = readZipEntry(bytes, entry, budget - used);
    used += data.byteLength;
    if (used > budget) throw new ZipError("zip archive inflates past the byte budget");
    out.set(entry.name, data);
  }
  return out;
}

// --- writer (fixtures) -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Writes a deflated zip archive (used to build XLSX fixtures in tests). */
export function writeZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = typeof file.data === "string" ? enc.encode(file.data) : file.data;
    const deflated = new Uint8Array(deflateRawSync(raw));
    const name = enc.encode(file.name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length + deflated.length);
    const lv = view(local);
    lv.setUint32(0, LOC_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(deflated, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = view(central);
    cv.setUint32(0, CEN_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, deflated.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cenSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = view(eocd);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const total = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    total.set(part, p);
    p += part.length;
  }
  return total;
}
