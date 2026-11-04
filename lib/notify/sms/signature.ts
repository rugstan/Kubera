import { createPublicKey, verify } from "node:crypto";

// Telnyx signs webhooks with Ed25519 over `${timestamp}|${rawBody}`. Headers:
//   telnyx-signature-ed25519  base64 signature
//   telnyx-timestamp          unix seconds
// The public key (portal, Keys & Credentials, Public key) is the raw 32-byte
// key, base64 encoded.

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const TELNYX_TOLERANCE_SECONDS = 5 * 60;

export type TelnyxSignatureInput = {
  publicKeyBase64: string;
  signatureBase64: string | null;
  timestamp: string | null;
  rawBody: string;
  now?: Date;
  toleranceSeconds?: number;
};

export function verifyTelnyxSignature(input: TelnyxSignatureInput): boolean {
  const { publicKeyBase64, signatureBase64, timestamp, rawBody } = input;
  if (!signatureBase64 || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (input.now ?? new Date()).getTime() / 1000;
  if (Math.abs(nowSec - ts) > (input.toleranceSeconds ?? TELNYX_TOLERANCE_SECONDS)) return false;
  try {
    const raw = Buffer.from(publicKeyBase64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`, "utf8"), key, signature);
  } catch {
    return false;
  }
}
