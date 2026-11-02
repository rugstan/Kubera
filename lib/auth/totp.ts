// RFC 6238 TOTP (SHA-1, 30 s, 6 digits): the algorithm authenticator apps and
// Supabase Auth use. The fake provider verifies codes with it, and tests and
// the e2e suite use it to produce codes for a known secret.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export const TOTP_PERIOD_SECONDS = 30;

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secret: string, atMs: number = Date.now(), period = TOTP_PERIOD_SECONDS): string {
  return hotp(secret, Math.floor(atMs / 1000 / period));
}

/** Accepts the current step and `window` steps either side (clock drift). */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  const given = Buffer.from(code);
  let ok = false;
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secret, step + d));
    if (timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

export function otpauthUri(secret: string, account: string, issuer = "Corin Commercial"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_SECONDS}`;
}
