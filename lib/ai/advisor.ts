import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MarketSnapshot } from "@/lib/rates";
import { disclosures, site } from "@/lib/site";
import { PROGRAM_PRIMER, retrieve } from "./knowledge";

// "System Two" — Claude for structuring questions and term sheet drafts.
const MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

// Frozen so the prompt cache prefix stays byte-identical across requests.
const SYSTEM = `You are Kubera AI, the debt advisory assistant for ${site.legalName}, a California DRE-licensed real estate corporation that arranges commercial real estate financing for senior living & healthcare, hospitality, and multifamily/commercial assets.

How to answer:
- Be precise and concise, like a senior capital markets advisor talking to a sophisticated borrower. Lead with the answer, then the reasoning. Use short sections and tables when comparing structures.
- Ground numbers in the program primer, the live market data, and any retrieved handbook excerpts. When a figure depends on underwriting, say so and give a range rather than a single number.
- If a question depends on facts you don't have (NOI, census, ADR, licensing status), ask for them or state the assumption you're making.
- Never promise approval, a rate lock, or a specific lender. Everything is indicative and subject to underwriting.
- Do not give legal, tax, or securities advice; suggest the borrower confirm with counsel or their CPA where relevant.
- When a borrower looks ready to proceed, invite them to submit the 60-second qualifier or book a call with a Kubera advisor.

${PROGRAM_PRIMER}`;

const TERM_SHEET_INSTRUCTIONS = `Draft an INDICATIVE term sheet in Markdown for the structure in the deal context below. Include: header (borrower/property placeholders, date), Loan Program, Loan Amount, Interest Rate (indicative, with index + spread), Term & Amortization, Recourse, Fees (MIP/guarantee fees as their own line, closing costs), Prepayment, Reserves, Key Conditions (third-party reports, licensing/franchise requirements), Timeline, and Next Steps. End with this disclaimer verbatim: "${disclosures.indicative}"`;

export type AdvisorMessage = { role: "user" | "assistant"; content: string };

export async function streamAdvisor(opts: {
  messages: AdvisorMessage[];
  market: MarketSnapshot;
  mode: "chat" | "term_sheet";
  dealContext?: string;
}): Promise<ReadableStream<Uint8Array>> {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const chunks = await retrieve(lastUser);

  const m = opts.market.benchmarks;
  const volatile = [
    `Market data as of ${opts.market.asOf}${opts.market.live ? "" : " (indicative — live feed unavailable)"}: 5-yr UST ${m.fiveYear.toFixed(2)}%, 10-yr UST ${m.tenYear.toFixed(2)}%, 30-day SOFR ${m.sofr30.toFixed(2)}%, WSJ Prime ${m.prime.toFixed(2)}%.`,
    `Program rate indications: ${opts.market.items.filter((i) => i.derived).map((i) => `${i.label} ${i.value}`).join("; ")}.`,
    chunks.length
      ? `Retrieved handbook excerpts:\n${chunks.map((c) => `<excerpt source="${c.source}"${c.section ? ` section="${c.section}"` : ""}>\n${c.content}\n</excerpt>`).join("\n")}`
      : "",
    opts.mode === "term_sheet" ? TERM_SHEET_INSTRUCTIONS : "",
    opts.dealContext ? `Deal context from the borrower's sizer session:\n${opts.dealContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: volatile },
    ],
    messages: opts.messages,
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nI can't help with that one here — a Kubera advisor can take it from here."));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n…(response truncated)"));
        }
      } catch (err) {
        console.error("advisor stream failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
        controller.enqueue(encoder.encode("\n\nKubera AI is temporarily unavailable. Please try again, or submit the qualifier and an advisor will follow up."));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
}
