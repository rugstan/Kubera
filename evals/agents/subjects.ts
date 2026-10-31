// Built-in eval subjects for evals/agents/*.json.
//
//   deterministic  qualifier.rules, mail.triage.rules, injection.scan,
//                  agents.tool_policy, lenders.static_routing
//   model (--live) mail.triage.model, documents.reference
//
// Agent owners add subjects in lib/agents/<agent>/eval-subjects.ts (export
// `subjects`); the runner discovers them (lib/agents/core/evals.ts).

import { z } from "zod";
import { decideWithRules, lendersFor } from "@/lib/ai/jev";
import { MODELS, modelGateway, type JsonSchema } from "@/lib/ai/gateway";
import { qualifierReasonCodes, staticRoutingCandidates } from "@/lib/agents/core/decisions";
import type { EvalSubject } from "@/lib/agents/core/evals";
import { addTaint, CLEAN, isolateUntrusted, scanForInjection, stripInstructions, UNTRUSTED_CONTENT_POLICY } from "@/lib/agents/core/injection";
import { AgentRegistry, approvedModels } from "@/lib/agents/core/registry";
import { BROKER, createHarness } from "@/lib/agents/core/testing";
import type { AutonomyLevel } from "@/lib/agents/core/autonomy";
import type { ToolOutcome } from "@/lib/agents/core/tools";
import { classifyByRules, classifyMail } from "@/lib/mail/classify";
import type { InboundMailbox } from "@/lib/mail/mailboxes";
import type { MailMessage } from "@/lib/mail/types";
import { intakeSchema } from "@/lib/validation";

// --- Qualifier -------------------------------------------------------------------------------------

const qualifierRules: EvalSubject = {
  kind: "deterministic",
  description: "Jev rules engine (decideWithRules) with reason codes",
  async run(input) {
    const intake = intakeSchema.parse(input);
    const r = { ...decideWithRules(intake), engine: "rules" as const, latencyMs: 0 };
    const d = r.decision;
    return {
      tier: d.leadUrgencyTier,
      program: d.primaryProgramFit,
      secondary: d.secondaryProgramFit,
      flag: d.sizingOptimizationFlag,
      vertical: d.assetVertical,
      callNow: d.requiresImmediateBrokerCall,
      lenders: d.recommendedWholesaleLenders,
      sizedLoan: r.primaryQuote ? Math.round(r.primaryQuote.loanAmount) : 0,
      reasonCodes: qualifierReasonCodes(r, intake),
    };
  },
};

// --- Mail triage -------------------------------------------------------------------------------------

const mailInput = z.object({
  mailbox: z.enum(["deals", "docs", "lenders", "vendors", "closing"]),
  subject: z.string(),
  fromAddress: z.string(),
  fromName: z.string().nullable().optional(),
  bodyText: z.string(),
  attachments: z.array(z.object({ fileName: z.string(), size: z.number().optional() })).default([]),
  automated: z.boolean().default(false),
  bulk: z.boolean().default(false),
  dmarc: z.enum(["pass", "fail", "none", "unknown"]).default("pass"),
  inReplyTo: z.string().nullable().optional(),
});

export function toMailMessage(raw: unknown, id = "eval-1"): MailMessage {
  const m = mailInput.parse(raw);
  return {
    providerMessageId: id,
    folderId: "inbox",
    mailbox: m.mailbox as InboundMailbox,
    subject: m.subject,
    fromAddress: m.fromAddress,
    fromName: m.fromName ?? null,
    toAddresses: [`${m.mailbox}@kuberacommercial.com`],
    ccAddresses: [],
    receivedAt: "2026-11-04T17:00:00.000Z",
    hasAttachments: m.attachments.length > 0,
    snippet: m.bodyText.slice(0, 200),
    internetMessageId: null,
    inReplyTo: m.inReplyTo ?? null,
    references: [],
    bodyText: m.bodyText,
    attachments: m.attachments.map((a, i) => ({ attachmentId: `att-${i}`, fileName: a.fileName, size: a.size ?? 1000, contentType: null })),
    automated: m.automated,
    bulk: m.bulk,
    dmarc: m.dmarc,
  };
}

const mailRules: EvalSubject = {
  kind: "deterministic",
  description: "Inbound mail triage, deterministic rules layer",
  async run(input, { caseId }) {
    return classifyByRules(toMailMessage(input, caseId));
  },
};

const mailModel: EvalSubject = {
  kind: "model",
  description: "Inbound mail triage through the model gateway (Haiku tier), merged with the rules",
  async run(input, { caseId }) {
    const r = await classifyMail(toMailMessage(input, caseId), { gateway: modelGateway() });
    return { ...r.classification, fallbackReason: r.fallbackReason };
  },
};

// --- Injection -----------------------------------------------------------------------------------------

const injectionScan: EvalSubject = {
  kind: "deterministic",
  description: "Injection scanner, stripping and content isolation",
  async run(input) {
    const { text, source } = z.object({ text: z.string(), source: z.enum(["email", "document", "attachment", "web", "sms", "form"]).default("email") }).parse(input);
    const scan = scanForInjection(text);
    const stripped = stripInstructions(text);
    const isolated = isolateUntrusted(text, { source });
    const closes = isolated.block.split(`</${isolated.tag}>`).length - 1;
    const inner = isolated.block.slice(isolated.block.indexOf(">") + 1, isolated.block.lastIndexOf(`</${isolated.tag}>`));
    return {
      flagged: scan.flagged,
      severity: scan.severity,
      codes: scan.codes,
      stripped: stripped.text,
      removed: stripped.removed,
      // Exactly one closing tag and no raw angle brackets inside: the content cannot escape.
      isolationIntact: closes === 1 && !/[<>]/.test(inner),
    };
  },
};

// --- Tool policy (agent safety contract) ----------------------------------------------------------------

const policyInput = z.object({
  task: z.string(),
  agent: z.string().default("eval.agent"),
  autonomy: z.enum(["audit", "assist", "automate"]).optional(),
  /** Untrusted content the agent read before acting (taints the run when flagged). */
  untrusted: z.string().optional(),
  trustedRecipients: z.array(z.string()).optional(),
  preApprovedTemplate: z.boolean().default(false),
  calls: z.array(z.object({ tool: z.string(), input: z.unknown() })).min(1),
  /** What the broker does with pending approvals after the first round. */
  broker: z.enum(["none", "approve", "approve_with_reauth", "reject", "timeout", "approve_after_timeout"]).default("none"),
  /** How many more times the agent repeats the same calls afterwards. */
  repeat: z.number().int().min(0).max(10).default(1),
});

const toolPolicy: EvalSubject = {
  kind: "deterministic",
  description: "Agent tool runner: scope, taint, autonomy, approval, re-auth and execute-once semantics",
  async run(input) {
    const p = policyInput.parse(input);
    const h = createHarness();
    if (p.preApprovedTemplate) h.addEmailTemplate();
    if (p.autonomy) h.autonomyStore.rows.push({ task: p.task, level: p.autonomy as AutonomyLevel, setAt: h.clock.now().toISOString(), setBy: BROKER.userId, setByLabel: BROKER.label, setByDre: BROKER.dreLicense!, reason: "eval" });
    const taint = p.untrusted ? addTaint(CLEAN, "email", scanForInjection(p.untrusted)) : CLEAN;
    const ctx = h.ctx({ task: p.task, agent: p.agent, taint, ...(p.trustedRecipients ? { trustedRecipients: p.trustedRecipients } : {}) });
    const round = async () => {
      const out: ToolOutcome[] = [];
      for (const c of p.calls) out.push(await h.runner.invoke(ctx, c));
      return out;
    };
    const first = await round();

    const pending = await h.approvals.list({ status: "pending" });
    for (const a of pending) {
      switch (p.broker) {
        case "approve": {
          const approved = await h.approvals.approve(a.id, BROKER);
          // The queue refuses a sensitive approval without a step-up. Mark it
          // approved behind the queue's back (as a legacy or hand-edited row
          // would be) so the runner's own re-authentication check is exercised.
          if (!approved.ok && approved.reason === "reauth_required") {
            await h.approvalStore.decide(a.id, { status: "approved", decidedBy: BROKER.userId, decidedByLabel: BROKER.label, decidedByDre: BROKER.dreLicense, decisionReason: null }, h.clock.now());
          }
          break;
        }
        case "approve_with_reauth":
          // Step-up first (fresh TOTP), then the decision, as the approvals page does.
          await h.reauth.record({ approval: a, user: { userId: BROKER.userId, dreLicense: BROKER.dreLicense }, factor: { method: "totp", verifiedAt: h.clock.now() } });
          await h.approvals.approve(a.id, BROKER);
          break;
        case "reject":
          await h.approvals.reject(a.id, BROKER, "Not now");
          break;
        case "timeout":
          break;
        case "approve_after_timeout":
          break;
      }
    }
    if (p.broker === "timeout" || p.broker === "approve_after_timeout") {
      h.clock.advance(25 * 60);
      if (p.broker === "approve_after_timeout") for (const a of pending) await h.approvals.approve(a.id, BROKER);
    }
    let last = first;
    for (let i = 0; i < p.repeat; i++) last = await round();

    const events = h.events.all();
    return {
      first: first.map((o) => o.status),
      final: last.map((o) => o.status),
      reasons: [...new Set([...first, ...last].flatMap((o) => ("reasons" in o ? o.reasons : [])))],
      sent: h.sent.length,
      sentTools: h.sent.map((s) => s.tool),
      approvals: h.approvalStore.all().length,
      autoApproved: h.approvalStore.all().filter((a) => a.autoApproved).length,
      eventTypes: [...new Set(events.map((e) => e.eventType))],
      eventCodes: [...new Set(events.flatMap((e) => e.reasonCodes))],
    };
  },
};

// --- Lenders -------------------------------------------------------------------------------------------

const staticRouting: EvalSubject = {
  kind: "deterministic",
  description: "Static LENDER_ROUTING fallback with reason codes",
  async run(input) {
    const { programId } = z.object({ programId: z.string() }).parse(input);
    const candidates = staticRoutingCandidates(lendersFor(programId));
    return { lenders: candidates.map((c) => c.lenderId), count: candidates.length, reasons: [...new Set(candidates.flatMap((c) => c.reasons))] };
  },
};

// --- Documents (reference extractor) -------------------------------------------------------------------

export const REFERENCE_EXTRACTOR_SYSTEM = `You extract structured data from commercial real estate loan documents for Kubera Commercial, a California-licensed loan broker. The user turn holds one document. Return only the JSON the schema asks for. Use numbers without currency symbols or thousands separators, percentages as numbers (91.5 for 91.5%), and dates as YYYY-MM-DD. Read totals from the document; when a total is not stated, compute it from the lines shown. Use null for anything the document does not state. Never invent values.

${UNTRUSTED_CONTENT_POLICY}`;

let registry: AgentRegistry | undefined;
function referencePrompt() {
  registry ??= new AgentRegistry(() => approvedModels());
  return registry.registerPrompt({
    id: "documents.reference_extractor",
    version: "1.0.0",
    description: "Baseline document extractor for golden-set evals",
    purpose: "document_extraction",
    model: MODELS.claude,
    effort: "medium",
    maxTokens: 8000,
    system: REFERENCE_EXTRACTOR_SYSTEM,
  });
}

const documentsReference: EvalSubject = {
  kind: "model",
  description: "Reference document extractor (Claude via the gateway, isolated content, structured output)",
  async run(input, { suite }) {
    const { fileName, text } = z.object({ fileName: z.string(), text: z.string() }).parse(input);
    if (!suite.outputSchema) throw new Error(`suite ${suite.suite} has no outputSchema`);
    const prompt = referencePrompt();
    const isolated = isolateUntrusted(text, { source: "document", label: fileName, strip: false });
    const res = await modelGateway().complete({
      model: prompt.model,
      purpose: "document_extraction",
      system: prompt.system,
      messages: [{ role: "user", content: `Document type: ${suite.docType ?? "unknown"}\n${isolated.block}\nExtract the fields.` }],
      maxTokens: prompt.maxTokens,
      effort: prompt.effort,
      jsonSchema: suite.outputSchema as JsonSchema,
      declared: { categories: ["deal"] },
      onSensitive: "redact",
      trace: { name: `eval.${suite.suite}`, metadata: { promptVersion: prompt.version, promptSha256: prompt.sha256 } },
    });
    if (res.refused) throw new Error("model refused");
    if (res.json === undefined) throw new Error(`no structured output (stop: ${res.stopReason})`);
    return res.json;
  },
};

export const BUILTIN_SUBJECTS: Record<string, EvalSubject> = {
  "qualifier.rules": qualifierRules,
  "mail.triage.rules": mailRules,
  "mail.triage.model": mailModel,
  "injection.scan": injectionScan,
  "agents.tool_policy": toolPolicy,
  "lenders.static_routing": staticRouting,
  "documents.reference": documentsReference,
};
