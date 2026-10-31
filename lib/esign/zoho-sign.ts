// Zoho Sign REST API v1 client (primary e-sign provider).
//
// Auth: OAuth 2.0 refresh-token flow against Zoho Accounts for the configured
// data center; access tokens are cached until shortly before expiry and
// refreshed once on a 401. Requests are created from a Zoho Sign template with
// prefilled fields; signers can sign remotely (emailed link) or embedded.
// Webhooks are verified with HMAC-SHA256 of the raw body (base64) in the
// `X-ZS-WEBHOOK-SIGNATURE` header using the secret set on the webhook.
//
// VERIFY against Zoho Sign's live API docs before go-live: endpoint paths, the
// template `createdocument` payload shape, webhook header name and payload
// fields (`requests`, `notifications.operation_type`, `performed_at`).

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
  type SignerAction,
} from "./types";

export type ZohoSignConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Data-center TLD: "com" (US), "eu", "in", "com.au", "jp", "ca", "sa". */
  dc: string;
  webhookSecret?: string;
};

export const ZOHO_SIGNATURE_HEADER = "x-zs-webhook-signature";

export function zohoSignConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZohoSignConfig | null {
  const { ZOHO_SIGN_CLIENT_ID, ZOHO_SIGN_CLIENT_SECRET, ZOHO_SIGN_REFRESH_TOKEN } = env;
  if (!ZOHO_SIGN_CLIENT_ID || !ZOHO_SIGN_CLIENT_SECRET || !ZOHO_SIGN_REFRESH_TOKEN) return null;
  return {
    clientId: ZOHO_SIGN_CLIENT_ID,
    clientSecret: ZOHO_SIGN_CLIENT_SECRET,
    refreshToken: ZOHO_SIGN_REFRESH_TOKEN,
    dc: env.ZOHO_SIGN_DC || "com",
    webhookSecret: env.ZOHO_SIGN_WEBHOOK_SECRET || undefined,
  };
}

const ALLOWED_DC = new Set(["com", "eu", "in", "com.au", "jp", "ca", "sa", "com.cn"]);

type Json = Record<string, unknown>;

const STATUS: Record<string, EsignRequestStatus> = {
  draft: "draft",
  inprogress: "in_progress",
  completed: "completed",
  declined: "declined",
  expired: "expired",
  recalled: "recalled",
};

const OPERATIONS: Record<string, EsignEventType> = {
  RequestSubmitted: "sent",
  RequestViewed: "viewed",
  RequestSigningSuccess: "recipient_signed",
  RequestCompleted: "completed",
  RequestRejected: "declined",
  RequestExpired: "expired",
  RequestRecalled: "recalled",
};

export class ZohoSignProvider implements EsignProvider {
  readonly name = "zoho_sign" as const;
  private token: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly templateActions = new Map<string, { actionId: string; role: string }[]>();

  constructor(
    private readonly config: ZohoSignConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly clock: () => number = () => Date.now(),
  ) {
    if (!ALLOWED_DC.has(config.dc)) throw new EsignError(`Unsupported Zoho data center: ${config.dc}`);
  }

  get accountsUrl(): string {
    return `https://accounts.zoho.${this.config.dc}`;
  }

  get apiUrl(): string {
    return `https://sign.zoho.${this.config.dc}/api/v1`;
  }

  // -- OAuth -----------------------------------------------------------------

  private async refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await this.fetchImpl(`${this.accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    // Zoho Accounts reports some failures with HTTP 200 and an `error` field.
    if (!res.ok || !json.access_token) throw new EsignError(`Zoho OAuth refresh failed: ${json.error ?? res.status}`, res.status);
    const ttlMs = (json.expires_in ?? 3600) * 1000;
    this.token = { value: json.access_token, expiresAt: this.clock() + ttlMs - 60_000 };
    return json.access_token;
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > this.clock()) return this.token.value;
    // Collapse concurrent refreshes into one request.
    this.refreshing ??= this.refreshAccessToken().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async request(path: string, init: { method: "GET" | "POST" | "PUT"; form?: Record<string, string> } = { method: "GET" }): Promise<Response> {
    const send = async (token: string) =>
      this.fetchImpl(`${this.apiUrl}${path}`, {
        method: init.method,
        headers: {
          authorization: `Zoho-oauthtoken ${token}`,
          ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: init.form ? new URLSearchParams(init.form) : undefined,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    let res = await send(await this.accessToken());
    if (res.status === 401) res = await send(await this.accessToken(true));
    if (!res.ok) throw new EsignError(`Zoho Sign ${init.method} ${path}: ${res.status} ${await res.text().catch(() => "")}`.trim(), res.status);
    return res;
  }

  private async json(path: string, init?: Parameters<ZohoSignProvider["request"]>[1]): Promise<Json> {
    const res = await this.request(path, init);
    const body = (await res.json()) as Json;
    if (body.status && body.status !== "success") throw new EsignError(`Zoho Sign ${path}: ${String(body.message ?? body.status)}`);
    return body;
  }

  // -- Requests ----------------------------------------------------------------

  private async actionsFor(templateId: string): Promise<{ actionId: string; role: string }[]> {
    const hit = this.templateActions.get(templateId);
    if (hit) return hit;
    const body = await this.json(`/templates/${encodeURIComponent(templateId)}`);
    const actions = ((body.templates as Json | undefined)?.actions as Json[] | undefined) ?? [];
    const mapped = actions.map((a) => ({ actionId: String(a.action_id), role: String(a.role ?? "") }));
    if (!mapped.length) throw new EsignError(`Zoho Sign template ${templateId} has no signer roles`);
    this.templateActions.set(templateId, mapped);
    return mapped;
  }

  async createFromTemplate(input: CreateFromTemplateInput): Promise<CreatedRequest> {
    const roles = await this.actionsFor(input.templateId);
    const actions = input.recipients.map((r) => {
      const role = roles.find((a) => a.role.toLowerCase() === r.role.toLowerCase());
      if (!role) throw new EsignError(`Template ${input.templateId} has no role "${r.role}"`);
      return {
        action_id: role.actionId,
        action_type: "SIGN",
        recipient_name: r.name,
        recipient_email: r.email,
        role: role.role,
        is_embedded: Boolean(r.embedded),
        verify_recipient: Boolean(r.verifyByEmail),
        ...(r.verifyByEmail ? { verification_type: "EMAIL" } : {}),
        ...(r.privateNote ? { private_notes: r.privateNote } : {}),
      };
    });
    const data = {
      templates: {
        request_name: input.requestName,
        notes: input.notes ?? `Reference ${input.reference}`,
        field_data: { field_text_data: input.fields, field_boolean_data: {}, field_date_data: {} },
        actions,
      },
    };
    const body = await this.json(`/templates/${encodeURIComponent(input.templateId)}/createdocument`, {
      method: "POST",
      form: { data: JSON.stringify(data), is_quicksend: "true" },
    });
    const req = body.requests as Json | undefined;
    const requestId = req?.request_id ? String(req.request_id) : "";
    if (!requestId) throw new EsignError("Zoho Sign createdocument: no request_id in response");
    const returned = (req?.actions as Json[] | undefined) ?? [];
    const signerActions: SignerAction[] = returned.map((a) => ({
      actionId: String(a.action_id),
      role: String(a.role ?? ""),
      email: String(a.recipient_email ?? ""),
      embedded: Boolean(a.is_embedded),
    }));
    return { requestId, status: STATUS[String(req?.request_status ?? "inprogress")] ?? "in_progress", actions: signerActions };
  }

  async embeddedSigningUrl(requestId: string, actionId: string, host: string): Promise<string> {
    const body = await this.json(`/requests/${encodeURIComponent(requestId)}/actions/${encodeURIComponent(actionId)}/embedtoken`, {
      method: "POST",
      form: { host },
    });
    const url = body.sign_url;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new EsignError("Zoho Sign embedtoken: no sign_url");
    return url;
  }

  async getStatus(requestId: string): Promise<EsignRequestStatus> {
    const body = await this.json(`/requests/${encodeURIComponent(requestId)}`);
    const status = String((body.requests as Json | undefined)?.request_status ?? "");
    const mapped = STATUS[status];
    if (!mapped) throw new EsignError(`Zoho Sign: unknown request_status "${status}"`);
    return mapped;
  }

  async downloadSigned(requestId: string): Promise<Uint8Array> {
    const res = await this.request(`/requests/${encodeURIComponent(requestId)}/pdf`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 5) throw new EsignError("Zoho Sign returned an empty document");
    return bytes;
  }

  async recall(requestId: string, reason: string): Promise<void> {
    await this.json(`/requests/${encodeURIComponent(requestId)}/recall`, { method: "POST", form: { reason } });
  }

  // -- Webhooks ----------------------------------------------------------------

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = this.config.webhookSecret;
    if (!secret) return false;
    return verifyZohoSignature(rawBody, headers.get(ZOHO_SIGNATURE_HEADER) ?? "", secret);
  }

  parseWebhook(rawBody: string): EsignEvent | null {
    return parseZohoWebhook(rawBody);
  }
}

export function signZohoPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function verifyZohoSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signZohoPayload(rawBody, secret));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function parseZohoWebhook(rawBody: string): EsignEvent | null {
  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    return null;
  }
  const req = payload.requests as Json | undefined;
  const note = payload.notifications as Json | undefined;
  const requestId = req?.request_id != null ? String(req.request_id) : "";
  const operation = note?.operation_type != null ? String(note.operation_type) : "";
  if (!requestId || !operation) return null;
  const performedAt = Number(note?.performed_at);
  // Epoch 0 means "time not reported"; consumers fall back to receipt time.
  const occurredAt = Number.isFinite(performedAt) && performedAt > 0 ? new Date(performedAt) : new Date(0);
  const actorEmail = note?.performed_by_email ? String(note.performed_by_email) : undefined;
  const eventId = createHash("sha256").update(`zoho:${requestId}:${operation}:${performedAt}:${actorEmail ?? ""}`).digest("hex");
  return {
    provider: "zoho_sign",
    eventId,
    requestId,
    type: OPERATIONS[operation] ?? "other",
    occurredAt,
    actorEmail,
    providerType: operation,
  };
}
