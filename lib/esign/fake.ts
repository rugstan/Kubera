// In-memory e-sign provider for tests and local development
// (ESIGN_PROVIDER=fake). Webhooks use the Zoho Sign wire format and signature
// scheme so the real webhook handler can be exercised end to end.

import { parseZohoWebhook, signZohoPayload, verifyZohoSignature, ZOHO_SIGNATURE_HEADER } from "./zoho-sign";
import { EsignError, type CreateFromTemplateInput, type CreatedRequest, type EsignEvent, type EsignProvider, type EsignRequestStatus } from "./types";

type FakeRequest = { input: CreateFromTemplateInput; status: EsignRequestStatus; signed: Set<string>; createdAt: number };

const ZOHO_OPERATION: Record<string, string> = {
  sent: "RequestSubmitted",
  viewed: "RequestViewed",
  recipient_signed: "RequestSigningSuccess",
  completed: "RequestCompleted",
  declined: "RequestRejected",
  expired: "RequestExpired",
  recalled: "RequestRecalled",
};

export class FakeEsignProvider implements EsignProvider {
  readonly name = "fake" as const;
  readonly requests = new Map<string, FakeRequest>();
  private seq = 0;

  constructor(
    readonly webhookSecret = "fake-webhook-secret",
    private readonly signedPdf: Uint8Array = new TextEncoder().encode("%PDF-1.4\n% fake signed copy\n%%EOF\n"),
  ) {}

  async createFromTemplate(input: CreateFromTemplateInput): Promise<CreatedRequest> {
    if (!input.recipients.length) throw new EsignError("At least one recipient is required");
    this.seq += 1;
    const requestId = `fake_req_${this.seq}`;
    this.requests.set(requestId, { input, status: "in_progress", signed: new Set(), createdAt: this.seq });
    return {
      requestId,
      status: "in_progress",
      actions: input.recipients.map((r, i) => ({ actionId: `${requestId}_a${i + 1}`, role: r.role, email: r.email, embedded: Boolean(r.embedded) })),
    };
  }

  private get(requestId: string): FakeRequest {
    const r = this.requests.get(requestId);
    if (!r) throw new EsignError(`Unknown request ${requestId}`, 404);
    return r;
  }

  async embeddedSigningUrl(requestId: string, actionId: string, host: string): Promise<string> {
    this.get(requestId);
    return `https://sign.fake.test/embed/${requestId}/${actionId}?host=${encodeURIComponent(host)}`;
  }

  async getStatus(requestId: string): Promise<EsignRequestStatus> {
    return this.get(requestId).status;
  }

  async downloadSigned(requestId: string): Promise<Uint8Array> {
    if (this.get(requestId).status !== "completed") throw new EsignError("Request is not completed", 409);
    return this.signedPdf;
  }

  async recall(requestId: string): Promise<void> {
    this.get(requestId).status = "recalled";
  }

  /** Test helper: build a signed Zoho-format webhook for `type` and update local state. */
  webhook(requestId: string, type: keyof typeof ZOHO_OPERATION, opts: { email?: string; at?: Date } = {}): { body: string; headers: Headers } {
    const r = this.get(requestId);
    if (type === "recipient_signed" && opts.email) r.signed.add(opts.email);
    if (type === "completed") r.status = "completed";
    if (type === "declined") r.status = "declined";
    if (type === "expired") r.status = "expired";
    if (type === "recalled") r.status = "recalled";
    const body = JSON.stringify({
      requests: { request_id: requestId, request_status: r.status === "in_progress" ? "inprogress" : r.status, request_name: r.input.requestName },
      notifications: {
        operation_type: ZOHO_OPERATION[type],
        performed_by_email: opts.email ?? r.input.recipients[0]?.email,
        performed_at: (opts.at ?? new Date(1_800_000_000_000 + this.seq)).getTime(),
        activity: `fake ${type}`,
      },
    });
    return { body, headers: new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, this.webhookSecret), "content-type": "application/json" }) };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    return verifyZohoSignature(rawBody, headers.get(ZOHO_SIGNATURE_HEADER) ?? "", this.webhookSecret);
  }

  parseWebhook(rawBody: string): EsignEvent | null {
    const e = parseZohoWebhook(rawBody);
    return e ? { ...e, provider: "fake" } : null;
  }
}
