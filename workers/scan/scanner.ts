// Malware scanner interface. Implementations: ClamAV over REST (clamav.ts) and
// an in-memory fake (fake.ts). A scanner never throws for "could not scan":
// it returns `status: "error"`, and the document stays quarantined.

export type ScanVerdict =
  | { status: "clean"; engine: string }
  | { status: "infected"; engine: string; signature: string }
  | { status: "error"; engine: string; message: string };

export interface MalwareScanner {
  /** Short engine label stored with the result, e.g. "clamav-rest". */
  readonly name: string;
  scan(bytes: Uint8Array, fileName: string): Promise<ScanVerdict>;
}
