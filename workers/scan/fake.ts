// In-memory scanner for tests and local development. Detects the standard
// EICAR test string (assembled at runtime so this file is not itself flagged by
// antivirus tools) and can be told to fail, to exercise retry paths.

import type { MalwareScanner, ScanVerdict } from "./scanner";

export const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");

export class FakeScanner implements MalwareScanner {
  readonly name = "fake";
  readonly calls: { fileName: string; size: number }[] = [];
  /** The next N scans return an error verdict. */
  failNext = 0;
  /** Extra byte patterns to treat as malware: pattern -> signature name. */
  readonly signatures = new Map<string, string>();

  async scan(bytes: Uint8Array, fileName: string): Promise<ScanVerdict> {
    this.calls.push({ fileName, size: bytes.byteLength });
    if (this.failNext > 0) {
      this.failNext--;
      return { status: "error", engine: this.name, message: "simulated scanner outage" };
    }
    const text = new TextDecoder("latin1").decode(bytes);
    if (text.includes(EICAR)) return { status: "infected", engine: this.name, signature: "Eicar-Test-Signature" };
    for (const [pattern, signature] of this.signatures) if (text.includes(pattern)) return { status: "infected", engine: this.name, signature };
    return { status: "clean", engine: this.name };
  }
}
