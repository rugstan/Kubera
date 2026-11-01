// Model routing guard: decides whether a payload may be sent to a given model.
//
// Every model call goes through `checkRoute` (or `assertRoutable`) before
// anything leaves the server; the model gateway (lib/ai/gateway.ts, WS-Q)
// calls it for Claude, NVIDIA NIM and xAI alike. The guard classifies the
// payload with lib/privacy/classification.ts, raises it to whatever the caller
// declares, and compares the result with two ceilings: the provider's and the
// purpose's. It fails closed: an unknown provider or model gets the public
// ceiling.
//
// Hard rules:
//   - xAI never receives borrower data (or partner data, or anything above public).
//   - Market-intel models never receive restricted fields, borrower or partner
//     data; they work from public signals only.
//   - Restricted data goes only to Claude, and only for document extraction
//     (PFS, tax returns and bank statements are restricted by nature).
//   - A person who opted out of AI processing (privacy_preferences) has no
//     personal data sent to any model.
//   - The remote Jev lead-scoring endpoint (lib/ai/jev.ts) gets the structured
//     intake only, up to confidential, never the free-text notes.

import {
  classifyPayload,
  levelRank,
  maxLevel,
  redactPayload,
  withinCeiling,
  type Classification,
  type DataCategory,
  type Finding,
} from "@/lib/privacy/classification";

/** Providers the model gateway (lib/ai/gateway.ts) can call. */
export const MODEL_PROVIDERS = ["anthropic", "nvidia", "xai"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/**
 * Model endpoints called directly rather than through the gateway, which still
 * pass this guard: `jev` is the remote Jev lead-scoring endpoint (JEV_API_URL,
 * lib/ai/jev.ts).
 */
export const DIRECT_PROVIDERS = ["jev"] as const;
export type RouteProvider = ModelProvider | (typeof DIRECT_PROVIDERS)[number];

export function isModelProvider(p: RouteProvider): p is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(p);
}

export const AI_PURPOSES = ["advisor", "document_extraction", "classification", "embedding", "drafting", "market_intel", "lead_scoring"] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

type ProviderPolicy = {
  /** Highest level this provider may receive for any purpose. */
  ceiling: Classification;
  /** Purposes for which restricted data is allowed (only when ceiling is restricted). */
  restrictedPurposes: readonly AiPurpose[];
  /** Data categories this provider must never receive above public. */
  forbiddenCategories: readonly DataCategory[];
  note: string;
};

export const PROVIDER_POLICY: Readonly<Record<RouteProvider, ProviderPolicy>> = {
  anthropic: {
    ceiling: "restricted",
    restrictedPurposes: ["document_extraction"],
    forbiddenCategories: [],
    note: "Commercial API terms; no training on inputs. Restricted data only for document extraction.",
  },
  nvidia: {
    ceiling: "confidential",
    restrictedPurposes: [],
    forbiddenCategories: [],
    note: "NIM for extraction and embeddings; never restricted fields.",
  },
  xai: {
    ceiling: "public",
    restrictedPurposes: [],
    forbiddenCategories: ["borrower", "partner", "deal"],
    note: "Market intelligence from public signals only. Never borrower data.",
  },
  jev: {
    ceiling: "confidential",
    restrictedPurposes: [],
    forbiddenCategories: [],
    note: "Remote Jev lead-scoring refinement. Structured intake only: never restricted fields, and the free-text notes are not sent.",
  },
};

type PurposePolicy = { ceiling: Classification; forbiddenCategories: readonly DataCategory[] };

export const PURPOSE_POLICY: Readonly<Record<AiPurpose, PurposePolicy>> = {
  advisor: { ceiling: "confidential", forbiddenCategories: [] },
  document_extraction: { ceiling: "restricted", forbiddenCategories: [] },
  classification: { ceiling: "confidential", forbiddenCategories: [] },
  embedding: { ceiling: "confidential", forbiddenCategories: [] },
  drafting: { ceiling: "confidential", forbiddenCategories: [] },
  market_intel: { ceiling: "internal", forbiddenCategories: ["borrower", "partner", "deal"] },
  lead_scoring: { ceiling: "confidential", forbiddenCategories: [] },
};

/** Ceiling for a provider or model we cannot identify. */
const UNKNOWN_CEILING: Classification = "public";

export type RefusalCode =
  | "unknown_provider"
  | "provider_model_mismatch"
  | "exceeds_provider_ceiling"
  | "exceeds_purpose_ceiling"
  | "restricted_not_allowed"
  | "borrower_data_to_xai"
  | "forbidden_category_for_provider"
  | "forbidden_category_for_purpose"
  | "subject_opted_out";

/** Infers the provider from a model id ("claude-…", "grok-…", "nvidia/…", "meta/llama-…"). */
export function providerForModel(model: string): ModelProvider | null {
  const m = model.trim().toLowerCase();
  if (/^(claude-|anthropic[./:])/.test(m) || /^(us|eu|apac|global)\.anthropic\./.test(m)) return "anthropic";
  if (/^(grok-|xai[./:])/.test(m)) return "xai";
  if (/^(nvidia|meta|mistralai|nv-|baai|snowflake|ibm)\//.test(m) || /^nvidia[.:-]/.test(m)) return "nvidia";
  return null;
}

export type RouteRequest = {
  /** Model id as sent to the provider. */
  model: string;
  /** Explicit provider (gateway routes); must agree with the model id when both are known. */
  provider?: RouteProvider;
  purpose: AiPurpose;
  /** Everything that will be sent: system prompt, messages, documents, tool inputs. */
  payload: unknown;
  /**
   * What the caller knows about the data. `level` is the baseline for
   * unclassified text (detection can only raise it); `categories` add to what
   * detection finds. Market-intel callers declare { level: "public" }.
   */
  declared?: { level?: Classification; categories?: readonly DataCategory[] };
  /** Table the payload's top-level keys come from, for registry lookups. */
  table?: string;
  /** The data subject's AI preference (lib/privacy/preferences.ts). */
  subject?: { aiProcessingOptOut?: boolean };
};

export type RouteDecision = {
  allowed: boolean;
  provider: RouteProvider | null;
  level: Classification;
  categories: DataCategory[];
  /** Effective ceiling for this provider × purpose. */
  ceiling: Classification;
  reasons: RefusalCode[];
  findings: Finding[];
};

/** Effective ceiling for a provider and purpose (the lower of the two). */
export function routeCeiling(provider: RouteProvider | null, purpose: AiPurpose): Classification {
  if (!provider) return UNKNOWN_CEILING;
  const p = PROVIDER_POLICY[provider];
  let ceiling: Classification = levelRank(p.ceiling) < levelRank(PURPOSE_POLICY[purpose].ceiling) ? p.ceiling : PURPOSE_POLICY[purpose].ceiling;
  if (ceiling === "restricted" && !p.restrictedPurposes.includes(purpose)) ceiling = "confidential";
  return ceiling;
}

/** Pure decision: may this payload go to this model for this purpose? */
export function checkRoute(req: RouteRequest): RouteDecision {
  const reasons = new Set<RefusalCode>();
  const inferred = providerForModel(req.model);
  const provider = req.provider ?? inferred;
  if (!provider) reasons.add("unknown_provider");
  if (req.provider && inferred && req.provider !== inferred) reasons.add("provider_model_mismatch");

  const baseline = req.declared?.level ?? "internal";
  const classified = classifyPayload(req.payload, { table: req.table, defaultLevel: baseline });
  // A declared level is a floor; detection can only raise it.
  const level = req.declared?.level ? maxLevel(classified.level, req.declared.level) : classified.level;
  const categories = [...new Set<DataCategory>([...classified.categories, ...(req.declared?.categories ?? [])])].sort();
  // Personal or deal data present at all (declared or detected above public).
  const sensitiveCategories = categories.filter((c) => c === "borrower" || c === "partner" || c === "deal");

  const ceiling = routeCeiling(provider, req.purpose);

  if (provider) {
    const pp = PROVIDER_POLICY[provider];
    if (!withinCeiling(level, pp.ceiling)) reasons.add("exceeds_provider_ceiling");
    if (level === "restricted" && !pp.restrictedPurposes.includes(req.purpose)) reasons.add("restricted_not_allowed");
    const forbidden = sensitiveCategories.filter((c) => pp.forbiddenCategories.includes(c));
    if (forbidden.length) reasons.add(provider === "xai" && forbidden.includes("borrower") ? "borrower_data_to_xai" : "forbidden_category_for_provider");
    // xAI: anything personal (an email in free text counts) is borrower data until proven otherwise.
    if (provider === "xai" && classified.pii) reasons.add("borrower_data_to_xai");
  } else if (!withinCeiling(level, UNKNOWN_CEILING)) {
    reasons.add("exceeds_provider_ceiling");
  }

  const purpose = PURPOSE_POLICY[req.purpose];
  if (!withinCeiling(level, purpose.ceiling)) reasons.add(level === "restricted" ? "restricted_not_allowed" : "exceeds_purpose_ceiling");
  if (sensitiveCategories.some((c) => purpose.forbiddenCategories.includes(c))) reasons.add("forbidden_category_for_purpose");

  if (req.subject?.aiProcessingOptOut && (classified.pii || sensitiveCategories.length > 0)) reasons.add("subject_opted_out");

  return { allowed: reasons.size === 0, provider, level, categories, ceiling, reasons: [...reasons].sort(), findings: classified.findings };
}

export class RoutingRefusedError extends Error {
  readonly decision: RouteDecision;
  constructor(decision: RouteDecision, req: Pick<RouteRequest, "model" | "purpose">) {
    super(`Model routing refused (${req.model}, ${req.purpose}): ${decision.reasons.join(", ")}`);
    this.name = "RoutingRefusedError";
    this.decision = decision;
  }
}

/** Throws RoutingRefusedError unless the route is allowed. Logs refusals without the payload. */
export function assertRoutable(req: RouteRequest): RouteDecision {
  const decision = checkRoute(req);
  if (!decision.allowed) {
    console.warn("[ai-routing] refused", {
      model: req.model,
      purpose: req.purpose,
      provider: decision.provider,
      level: decision.level,
      reasons: decision.reasons,
      // Paths and detector names only; never values.
      findings: decision.findings.slice(0, 20).map((f) => `${f.path || "(root)"}:${f.level}:${f.detail}`),
    });
    throw new RoutingRefusedError(decision, req);
  }
  return decision;
}

/**
 * For callers that would rather degrade than refuse (e.g. the advisor when a
 * user pastes an account number): redacts everything above the route's
 * ceiling, then re-checks. Returns null when the payload still cannot go
 * (opt-out, forbidden categories, unknown provider).
 */
export function prepareForRoute<T>(req: RouteRequest & { payload: T }): { payload: T; decision: RouteDecision } | null {
  const first = checkRoute(req);
  if (first.allowed) return { payload: req.payload, decision: first };
  const redacted = redactPayload(req.payload, first.ceiling, { table: req.table });
  const second = checkRoute({ ...req, payload: redacted });
  return second.allowed ? { payload: redacted, decision: second } : null;
}

/** Runs `send` only when the route is allowed. */
export async function guardedModelCall<T>(req: RouteRequest, send: () => Promise<T>): Promise<T> {
  assertRoutable(req);
  return send();
}
