// BoldSign fallback adapter (thin, used only if Zoho Sign is unavailable).
//
// Covers the same contract with BoldSign's REST API: send from template,
// embedded sign link, document properties, download, revoke, and webhook
// verification (`X-BoldSign-Signature: t=<unix>, s0=<hex HMAC-SHA256 of "t.body">`).
// VERIFY every path, payload and header against BoldSign's docs and run a
// sandbox send before switching ESIGN_PROVIDER to "boldsign".

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  EsignError,
  type CreateFromTemplateInput,
  type CreatedRequest,
  type EsignEvent,
  type EsignEventType,
  type EsignProvider,
  type EsignRequestStatus,
  type FetchLike,
} from "./types";

export type BoldSignConfig = { apiKey: string; webhookSecret?: string; baseUrl?: string };

export const BOLDSIGN_SIGNATURE_HEADER = "x-boldsign-signature";
const MAX_SKEW_S = 5 * 60;

export function boldSignConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BoldSignConfig | null {
  if (!env.BOLDSIGN_API_KEY) return null;
  return { apiKey: env.BOLDSIGN_API_KEY, webhookSecret: env.BOLDSIGN_WEBHOOK_SECRET || undefined };
}

type Json = Record<string, unknown>;

const STATUS: Record<string, EsignRequestStatus> = {
  draft: "draft",
  inprogress: "in_progress",
  waitingforothers: "in_progress",
  needstosign: "in_progress",
  completed: "completed",
  declined: "declined",
  expired: "expired",
  revoked: "recalled",
};

const EVENTS: Record<string, EsignEventType> = {
  Sent: "sent",
  Viewed: "viewed",
  Signed: "recipient_signed",
  Completed: "completed",
  Declined: "declined",
  Expired: "expired",
  Revoked: "recalled",
};

export class BoldSignProvider implements EsignProvider {
  readonly name = "boldsign" as const;
  private readonly base: string;

  constructor(
    private readonly config: BoldSignConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.base = (config.baseUrl ?? "https://api.boldsign.com").replace(/\/$/, "");
  }

  private async call(method: "GET" | "POST", path: string, body?: Json): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { "x-api-key": this.config.apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new EsignError(`BoldSign ${method} ${path}: ${res.status} ${await res.text().catch(() => "")}`.trim(), res.status);
    return res;
  }

  async createFromTemplate(input: CreateFromTemplateInput): Promise<CreatedRequest> {
    const fieldList = Object.entries(input.fields).map(([id, value]) => ({ id, value }));
    const roles = input.recipients.map((r, i) => ({
      roleIndex: i + 1,
      signerName: r.name,
      signerEmail: r.email,
      signerRole: r.role,
      ...(r.verifyByEmail ? { authenticationType: "EmailOTP" } : {}),
      ...(r.privateNote ? { privateMessage: r.privateNote } : {}),
      // Prefilled values ride on the first role; BoldSign applies them by field id.
      ...(i === 0 ? { existingFormFields: fieldList } : {}),
    }));
    const res = await this.call("POST", `/v1/template/send?templateId=${encodeURIComponent(input.templateId)}`, {
      title: input.requestName,
      message: input.notes ?? `Reference ${input.reference}`,
      roles,
      disableEmails: input.recipients.every((r) => r.embedded),
    });
    const json = (await res.json()) as Json;
    const requestId = json.documentId ? String(json.documentId) : "";
    if (!requestId) throw new EsignError("BoldSign template send: no documentId");
    return {
      requestId,
      status: "in_progress",
      actions: input.recipients.map((r) => ({ actionId: r.email, role: r.role, email: r.email, embedded: Boolean(r.embedded) })),
    };
  }

  async embeddedSigningUrl(requestId: string, actionId: string, host: string): Promise<string> {
    const qs = new URLSearchParams({ documentId: requestId, signerEmail: actionId, redirectUrl: host });
    const json = (await (await this.call("GET", `/v1/document/getEmbeddedSignLink?${qs}`)).json()) as Json;
    if (typeof json.signLink !== "string") throw new EsignError("BoldSign: no signLink");
    return json.signLink;
  }

  async getStatus(requestId: string): Promise<EsignRequestStatus> {
    const json = (await (await this.call("GET", `/v1/document/properties?documentId=${encodeURIComponent(requestId)}`)).json()) as Json;
    const status = STATUS[String(json.status ?? "").toLowerCase()];
    if (!status) throw new EsignError(`BoldSign: unknown status "${String(json.status)}"`);
    return status;
  }

  async downloadSigned(requestId: string): Promise<Uint8Array> {
    const res = await this.call("GET", `/v1/document/download?documentId=${encodeURIComponent(requestId)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async recall(requestId: string, reason: string): Promise<void> {
    await this.call("POST", `/v1/document/revoke?documentId=${encodeURIComponent(requestId)}`, { message: reason });
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = this.config.webhookSecret;
    const header = headers.get(BOLDSIGN_SIGNATURE_HEADER);
    if (!secret || !header) return false;
    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const [k, ...v] = p.trim().split("=");
        return [k ?? "", v.join("=")];
      }),
    );
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(this.clock() / 1000 - t) > MAX_SKEW_S || !parts.s0) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex"));
    const given = Buffer.from(parts.s0);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parseWebhook(rawBody: string): EsignEvent | null {
    let payload: Json;
    try {
      payload = JSON.parse(rawBody) as Json;
    } catch {
      return null;
    }
    const event = payload.event as Json | undefined;
    const data = payload.data as Json | undefined;
    const requestId = data?.documentId ? String(data.documentId) : "";
    const eventType = event?.eventType ? String(event.eventType) : "";
    if (!requestId || !eventType) return null;
    const created = Number(event?.created);
    return {
      provider: "boldsign",
      eventId: event?.id ? String(event.id) : createHash("sha256").update(`boldsign:${requestId}:${eventType}:${created}`).digest("hex"),
      requestId,
      type: EVENTS[eventType] ?? "other",
      occurredAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000) : new Date(0),
      providerType: eventType,
    };
  }
}
