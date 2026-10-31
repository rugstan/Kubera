import { serve } from "inngest/next";
import { inngest, workflowsConfigured } from "@/lib/workflows/client";
import { workflowFunctions } from "@/lib/workflows/server";

// Inngest calls this endpoint to discover and run Kubera's workflow functions
// (approval-gated outbound actions, inbound mail polling and processing, and
// the Phase 3 agents: document extraction, CRM notes, lender term sheets,
// speed-to-lead and the outreach sweep).
// Requests are verified with INNGEST_SIGNING_KEY by the SDK. Without Inngest
// configured (no keys and not INNGEST_DEV), it answers 503 and nothing runs.

export const maxDuration = 300;

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

let handlers: { GET: Handler; POST: Handler; PUT: Handler } | undefined;

function inngestHandlers() {
  handlers ??= serve({ client: inngest(), functions: workflowFunctions() }) as unknown as { GET: Handler; POST: Handler; PUT: Handler };
  return handlers;
}

function unavailable(): Response {
  return Response.json({ error: "Workflows are not configured" }, { status: 503 });
}

export async function GET(req: Request, ctx: unknown): Promise<Response> {
  return workflowsConfigured() ? inngestHandlers().GET(req, ctx) : unavailable();
}

export async function POST(req: Request, ctx: unknown): Promise<Response> {
  return workflowsConfigured() ? inngestHandlers().POST(req, ctx) : unavailable();
}

export async function PUT(req: Request, ctx: unknown): Promise<Response> {
  return workflowsConfigured() ? inngestHandlers().PUT(req, ctx) : unavailable();
}
