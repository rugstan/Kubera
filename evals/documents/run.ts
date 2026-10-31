// Document extraction eval runner.
//
//   npx tsx --conditions=react-server evals/documents/run.ts [--model <model id>] [--case <id>]
//
// Always scores the deterministic rules path on every golden case. When
// ANTHROPIC_API_KEY is set it also runs the model path (text through the
// gateway, and PDF cases as document blocks) and reports field accuracy per
// case; without a key the model path is skipped. Exit code 1 on any rules-path
// failure. Model runs spend money: each case is one request.

import { createGateway, MODELS } from "@/lib/ai/gateway";
import { AnthropicProvider } from "@/lib/ai/gateway/anthropic";
import { AnthropicDocumentClient } from "@/lib/agents/documents/claude-pdf";
import { parseDocument } from "@/lib/agents/documents/parse";
import { extractWithRules } from "@/lib/agents/documents/rules";
import { extractFromText } from "@/lib/agents/documents/text-model";
import { assessExtraction, validateExtraction } from "@/lib/agents/documents/validate";
import { loadDocumentEvals, sourceBytes, sourceText } from "./load";
import { scoreCase } from "./score";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { suites, errors } = loadDocumentEvals();
  if (errors.length) {
    for (const e of errors) console.error(`invalid: ${e}`);
    process.exit(1);
  }
  const only = arg("case");
  const model = arg("model") ?? MODELS.claude;
  const live = Boolean(process.env.ANTHROPIC_API_KEY);
  const gateway = live ? createGateway({ providers: { anthropic: new AnthropicProvider() } }) : null;
  const pdfClient = live ? new AnthropicDocumentClient({ model }) : null;
  let rulesFailed = 0;
  let modelChecked = 0;
  let modelPassed = 0;
  for (const { suite } of suites) {
    for (const c of suite.cases) {
      if (only && c.id !== only) continue;
      const src = sourceBytes(c);
      const rules = validateExtraction(extractWithRules(suite.docType, parseDocument(src.bytes, src.contentType).tables));
      const rs = scoreCase(c, rules, assessExtraction(rules));
      if (rs.failures.length) rulesFailed++;
      console.log(`${rs.failures.length ? "FAIL" : "ok  "} rules  ${c.id}  ${rs.passed}/${rs.checked}${rs.failures.length ? `\n      ${rs.failures.join("\n      ")}` : ""}`);
      if (!gateway || !pdfClient) continue;
      const res =
        c.source.format === "pdf"
          ? await pdfClient.extractPdf({ docType: suite.docType, pdf: src.bytes, fileName: src.fileName })
          : await extractFromText(gateway, { docType: suite.docType, text: sourceText(c), format: c.source.format, fileName: src.fileName, model });
      if (!res.result) {
        console.log(`FAIL model  ${c.id}  no result (${res.warnings.join(", ")})`);
        continue;
      }
      const v = validateExtraction(res.result);
      // Model confidence is capped, so the queue state is not part of the model score.
      const ms = scoreCase(c, v, assessExtraction(v), { checkStatus: false });
      modelChecked += ms.checked;
      modelPassed += ms.passed;
      console.log(`${ms.failures.length ? "miss" : "ok  "} model  ${c.id}  ${ms.passed}/${ms.checked}  ${res.call.inputTokens}+${res.call.outputTokens} tokens${ms.failures.length ? `\n      ${ms.failures.join("\n      ")}` : ""}`);
    }
  }
  if (!live) console.log("ANTHROPIC_API_KEY not set: model path skipped (rules path and eval files validated).");
  else console.log(`model field accuracy: ${modelPassed}/${modelChecked}`);
  process.exit(rulesFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
