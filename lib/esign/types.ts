// E-signature provider contract. Zoho Sign is primary, BoldSign the fallback,
// and an in-memory fake backs tests. Callers never talk to a vendor directly:
// they go through this interface, and every send passes the broker approval
// gate first (lib/compliance/approval-gate.ts).

export type EsignProviderName = "zoho_sign" | "boldsign" | "fake";

export type Recipient = {
  /** Template role this signer fills, e.g. "Borrower 1", "Broker". */
  role: string;
  name: string;
  email: string;
  /** Embedded signing (inside Corin's portal) instead of an emailed link. */
  embedded?: boolean;
  /** Ask the provider to verify the signer by email OTP before signing. */
  verifyByEmail?: boolean;
  privateNote?: string;
};

export type CreateFromTemplateInput = {
  templateId: string;
  requestName: string;
  recipients: Recipient[];
  /** Prefilled text fields keyed by template field label. */
  fields: Record<string, string>;
  notes?: string;
  /** Our own reference (disclosure id), echoed in the request name/notes for traceability. */
  reference: string;
};

export type SignerAction = { actionId: string; role: string; email: string; embedded: boolean };

export type CreatedRequest = { requestId: string; status: EsignRequestStatus; actions: SignerAction[] };

export type EsignRequestStatus = "draft" | "in_progress" | "completed" | "declined" | "expired" | "recalled";

/** Normalized webhook event. */
export type EsignEventType = "sent" | "viewed" | "recipient_signed" | "completed" | "declined" | "expired" | "recalled" | "other";

export type EsignEvent = {
  provider: EsignProviderName;
  /** Stable id for idempotency (provider event id or a hash of its identifying fields). */
  eventId: string;
  requestId: string;
  type: EsignEventType;
  occurredAt: Date;
  actorEmail?: string;
  /** Raw provider operation name, for the audit trail. */
  providerType: string;
};

export interface EsignProvider {
  readonly name: EsignProviderName;
  createFromTemplate(input: CreateFromTemplateInput): Promise<CreatedRequest>;
  /** One-time URL for embedded (in-portal) signing. `host` is the embedding origin. */
  embeddedSigningUrl(requestId: string, actionId: string, host: string): Promise<string>;
  getStatus(requestId: string): Promise<EsignRequestStatus>;
  /** Signed, completed PDF (the borrower's exact copy). */
  downloadSigned(requestId: string): Promise<Uint8Array>;
  recall(requestId: string, reason: string): Promise<void>;
  /**
   * Requests created with `reference` (newest first), so an ambiguous send
   * (timeout after the provider accepted it) is reconciled instead of repeated.
   * Optional: providers without a lookup cannot reconcile.
   */
  findByReference?(reference: string): Promise<CreatedRequest[]>;
  /** Verify the webhook signature over the raw body. Never parse an unverified body. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Parse a verified webhook body; null when it is not a signing event. */
  parseWebhook(rawBody: string): EsignEvent | null;
}

export class EsignError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Worth retrying later (throttled OAuth refresh, network, 5xx). */
    readonly retryable: boolean = status === undefined || status === 429 || status >= 500,
  ) {
    super(message);
    this.name = "EsignError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
