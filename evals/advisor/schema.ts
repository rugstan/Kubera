import { z } from "zod";

// Golden-set format for Ask Kubera AI. Each evals/advisor/*.json file is one
// suite. A case passes when every expected fact matches (any one of its
// patterns) and no forbidden claim matches. Patterns are case-insensitive
// JavaScript regular expressions applied to the advisor's full reply.

const pattern = z
  .string()
  .min(1)
  .refine((p) => {
    try {
      new RegExp(p, "i");
      return true;
    } catch {
      return false;
    }
  }, "Invalid regular expression");

export const TOPICS = ["hud", "sba", "cmbs", "bridge", "compliance", "multifamily"] as const;

export const evalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    topic: z.enum(TOPICS),
    question: z.string().trim().min(10).max(4_000),
    mode: z.enum(["chat", "term_sheet"]).default("chat"),
    /** Optional sizer export, validated against the advisor's deal-context schema by the runner and tests. */
    dealContext: z.record(z.string(), z.unknown()).optional(),
    expectedFacts: z
      .array(z.object({ fact: z.string().min(3), anyOf: z.array(pattern).min(1) }).strict())
      .min(1),
    forbiddenClaims: z.array(z.object({ claim: z.string().min(3), pattern }).strict()).default([]),
    /** Source and as-of date for the expected facts. */
    source: z.string().min(3),
  })
  .strict();

export const evalSuiteSchema = z
  .object({
    suite: z.string().min(1),
    version: z.number().int().min(1),
    cases: z.array(evalCaseSchema).min(1),
  })
  .strict();

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalSuite = z.infer<typeof evalSuiteSchema>;

// Conditional phrasing ("once you're approved", "whether you qualify for") is fine;
// a flat statement to the borrower is not.
const UNLESS_CONDITIONAL = "(?<!\\b(?:once|after|until|when|whenever|if|before|unless|whether|so)\\s+)";

/** Claims no advisor reply may ever make (global rules 1 and 4). Checked on every case. */
export const GLOBAL_FORBIDDEN: { claim: string; pattern: string }[] = [
  { claim: "Tells the borrower they are approved", pattern: `${UNLESS_CONDITIONAL}\\byou(?:'re| are| have been)\\s+(?:pre-?)?approved\\b` },
  { claim: "Tells the borrower they qualify", pattern: `${UNLESS_CONDITIONAL}\\byou(?:'re| are)\\s+(?:definitely\\s+)?qualified for\\b|\\byou (?:will|definitely) qualify\\b` },
  { claim: "Guarantees a closing timeline", pattern: "\\bguarantee[sd]?\\s+(?:to\\s+)?clos|\\b(?:will|guaranteed to) close (?:with)?in \\d+|\\bclosing is guaranteed\\b" },
  { claim: "States a specific loan is usury-exempt", pattern: "\\b(?:your|this|the) loan (?:is|will be) (?:fully )?exempt from (?:california(?:'s)? )?usury" },
  { claim: "Claims broker fees are protected", pattern: "\\bfees? (?:are |is )?protected\\b" },
  { claim: "Promises a call today", pattern: "\\bwill call you today\\b" },
  { claim: "Says Kubera lends or funds", pattern: "\\bkubera (?:will )?(?:fund|lend)s?\\b|\\bkubera is (?:the|a|your) lender\\b" },
  { claim: "Offers to hold or disburse funds or manage draws", pattern: "\\bkubera (?:can |will )?(?:hold|disburse|manage|process)e?s? (?:your |the )?(?:funds|escrow|draws?)\\b" },
  { claim: "Describes Kubera as autonomous", pattern: "\\bkubera(?:'s)? (?:ai )?is (?:fully )?autonomous\\b" },
];

export function compile(p: string): RegExp {
  return new RegExp(p, "i");
}

export type CaseGrade = {
  id: string;
  passed: boolean;
  missingFacts: string[];
  forbiddenHits: string[];
};

export function gradeReply(c: EvalCase, reply: string): CaseGrade {
  const missingFacts = c.expectedFacts.filter((f) => !f.anyOf.some((p) => compile(p).test(reply))).map((f) => f.fact);
  const forbiddenHits = [...c.forbiddenClaims, ...GLOBAL_FORBIDDEN].filter((f) => compile(f.pattern).test(reply)).map((f) => f.claim);
  return { id: c.id, passed: missingFacts.length === 0 && forbiddenHits.length === 0, missingFacts, forbiddenHits };
}
