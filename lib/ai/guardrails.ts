// Output guardrails for Ask Kubera AI: a post-generation filter that checks what
// the model wrote before the borrower sees it.
//
// The system prompt already forbids these things; this is the independent check
// that does not rely on the model obeying it (Global rules 1 and 4). It looks
// for:
//   commitment          approval, rate-lock or funding promises, "you are approved"
//   legal_advice        legal conclusions, tax advice, "no need for an attorney"
//   usury_exemption     any statement that a specific loan is usury-exempt
//   guaranteed_timeline closing or funding dates stated as certain
//   broker_role         Kubera as lender, holder of funds, servicer or draw manager
//   disclosure_waiver   telling a borrower the MLDS (RE 882) is not needed
//   prohibited_copy     "fees protected", "will call you today", "autonomous"
//
// The filter works on sentence-sized units so replies still stream: a unit is
// checked when its sentence (or line) ends, and a unit that trips a rule is
// replaced by a fixed, compliant sentence. Rules are regular expressions with
// two escape hatches that keep correct statements out of the way: a negator in
// the same clause ("we can't guarantee ...") and a conditional lead-in
// ("once you're approved ..."). It is pure and has no I/O, so it cannot fail
// closed on an outage; sinks that record hits live in lib/ai/review.

export const GUARDRAIL_CATEGORIES = [
  "commitment",
  "legal_advice",
  "usury_exemption",
  "guaranteed_timeline",
  "broker_role",
  "disclosure_waiver",
  "prohibited_copy",
] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];

export const GUARDRAIL_CATEGORY_LABELS: Record<GuardrailCategory, string> = {
  commitment: "Commitment language",
  legal_advice: "Legal or tax advice",
  usury_exemption: "Usury-exemption claim",
  guaranteed_timeline: "Guaranteed timeline",
  broker_role: "Broker-only role",
  disclosure_waiver: "Disclosure waiver",
  prohibited_copy: "Prohibited copy",
};

export type GuardrailRule = {
  id: string;
  category: GuardrailCategory;
  description: string;
  pattern: RegExp;
  /**
   * Extra requirement on the whole unit. Used where a phrase is only a problem
   * when it is about this borrower's loan (usury) rather than a general fact.
   */
  requires?: RegExp;
  /**
   * A unit that also matches this is a hedged general statement, not a promise
   * ("we typically close in 10 days after a complete file; not guaranteed").
   */
  unlessUnit?: RegExp;
  /** When false, a negator never clears a hit (the phrase is a problem however it is hedged). Default true. */
  negatable?: boolean;
  /**
   * When false, only a negator before the match (same clause) clears a hit; a negator inside
   * the matched text is part of the claim ("is not subject to usury"). Default true.
   */
  negateInside?: boolean;
};

/** Words that turn a phrase into a disclaimer ("we can't guarantee"). */
const NEGATOR = /\b(?:not|no|never|cannot|can't|can’t|won't|won’t|don't|don’t|doesn't|doesn’t|didn't|isn't|isn’t|aren't|aren’t|wouldn't|shouldn't|couldn't|without|nor|neither|unable|avoid|refrain)\b|n't\b/i;

/** A lead-in that makes an approval statement hypothetical. */
const CONDITIONAL = /\b(?:once|after|until|when|whenever|if|before|unless|whether|so that|in case)\s+(?:\w+\s+){0,3}$/i;

/** Clause breaks end the reach of a negator. */
const CLAUSE_BREAK = /[,;:—–]|\s-\s|\b(?:but|however|although|though|while|whereas|yet)\b/gi;

const YOU = String.raw`(?:you|you're|you’re|your (?:loan|application|file|deal|request|financing))`;

/** Loan nouns a usury claim can be about. */
const LOAN_NOUN = String.raw`(?:loan|deal|financing|transaction|rate|structure|bridge|note|facility|refinance)`;
/** A usury phrase is a problem when it is about this borrower's loan, not a general fact. */
const LOAN_REF = new RegExp(String.raw`\b(?:your|this|that|the)\s+${LOAN_NOUN}\b|\byou(?:r)?\b`, "i");
/** Stricter: only "your ..." or "this/that <loan noun>" (the general "the exemption applies to loans ..." is a fact). */
const BORROWER_LOAN_REF = new RegExp(String.raw`\byou(?:r)?\b|\b(?:this|that)\s+(?:\S+\s+){0,3}?${LOAN_NOUN}\b`, "i");

/** Kubera, or "our team / staff / desk ..." speaking for it. */
const KUBERA_SUBJECT = String.raw`(?:we|kubera(?: commercial)?|our (?:team|staff|desk|advisors?|brokers?|office|firm|people))(?:'ll|’ll)?`;
/** Up to two modifier tokens before a noun ("the construction draws", "your monthly payments"). */
const MODIFIERS = String.raw`(?:[\w'’$%.-]+\s+){0,2}`;
/** A count of days, weeks or hours ("14 days", "two weeks", "10–21 days"). */
const DURATION = String.raw`(?:about |around |roughly |just |only |under |less than |as (?:little|few) as )?(?:\d+(?:\s*(?:-|–|to)\s*\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|forty|forty-five|sixty|ninety|a few|a couple of|a)\s+(?:business |calendar |working )?(?:days?|weeks?|hours?)\b`;
/** Hedges that make a timeline a general, non-binding statement. */
const TIMELINE_HEDGE = /\b(?:typically|typical|usually|often|generally|many|on average|in many cases|not guaranteed|isn't guaranteed|isn’t guaranteed|is not guaranteed|no guarantee|never guaranteed)\b/i;

const R = (id: string, category: GuardrailCategory, description: string, pattern: RegExp, extra: Partial<GuardrailRule> = {}): GuardrailRule => ({ id, category, description, pattern, ...extra });

export const GUARDRAIL_RULES: readonly GuardrailRule[] = [
  // --- commitment ---------------------------------------------------------------
  R("commitment.you-are-approved", "commitment", "Tells the borrower they are approved", /\byou(?:'re|’re| are| have been|'ve been|’ve been| will be| were)\s+(?:now |already |officially |fully |definitely |all set and )?(?:pre-?)?approved\b/i),
  R("commitment.loan-approved", "commitment", "Says the loan or application is approved or funded", /\b(?:your|the|this|that) (?:loan|application|file|deal|request|financing)\s+(?:is|has been|was|will be|has now been)\s+(?:now |already |officially |fully |pre-?)?(?:approved|funded|committed|cleared)\b/i),
  R("commitment.will-be-approved", "commitment", "Predicts approval as certain", new RegExp(`\\b${YOU}\\s+(?:will|are going to|is going to|are certain to|is certain to|definitely will|will definitely|will certainly)\\s+(?:definitely |certainly |surely )?(?:be |get |receive )?(?:approved|funded|financed)\\b`, "i")),
  R("commitment.you-qualify", "commitment", "Tells the borrower they qualify", /\byou(?:'re|’re| are)\s+(?:definitely |already |certainly |clearly )?(?:pre-?)?qualified\s+(?:for|to)\b|\byou(?:'ve|’ve| have| has)\s+(?:now\s+|already\s+|officially\s+|definitely\s+)?(?:been\s+)?(?:now\s+|already\s+|officially\s+|definitely\s+)?(?:pre-?)?qualified\s+(?:for|to)\b|\byou\s+(?:(?:will|definitely|certainly|clearly)\s+)+qualify\b|\byou\s+(?:now\s+|already\s+|also\s+|easily\s+)?qualify\s+for\b/i),
  R("commitment.we-guarantee", "commitment", "Guarantees an outcome", /\b(?:we|kubera|i)\s+(?:can |will |do |hereby )?(?:guarantee|promise|assure|ensure|commit to)\b/i),
  R("commitment.guaranteed-outcome", "commitment", "Guaranteed approval, funding or financing", /\b(?:guaranteed|assured|100%|certain) (?:approval|funding|financing|closing|loan|rate|terms)\b|\b(?:approval|funding|financing|closing)\s+(?:is|are|will be)\s+(?:guaranteed|assured|certain)\b/i),
  R("commitment.rate-lock", "commitment", "Says a rate is locked or guaranteed", /\byour (?:rate|pricing|terms)\s+(?:is|are|has been|have been|will be)\s+(?:locked|guaranteed|fixed|set)\b|\b(?:we|kubera)(?:'ll|’ll| will| can)\s+(?:lock|secure)\s+(?:in\s+)?(?:a |your |the )?(?:rate|pricing|terms)\b/i),
  R("commitment.will-fund", "commitment", "Says a lender will definitely fund or approve", /\b(?:will|would)\s+(?:definitely|certainly|absolutely|surely)\s+(?:fund|lend|approve|close|offer|issue)\b|\b(?:lender|bank|fund)\s+(?:has|have)\s+(?:agreed|committed)\s+to\s+(?:fund|lend|finance)\b/i),
  R("commitment.we-will-get-you", "commitment", "Promises to get the borrower a loan", /\b(?:we|kubera)(?:'ll|’ll| will| can)\s+(?:definitely |certainly |absolutely )?get you\s+(?:approved|funded|financed|a loan|the loan|the financing)\b/i),

  // --- legal / tax advice -----------------------------------------------------------
  R("legal.legally-must", "legal_advice", "States what the borrower must or may do under the law", /\b(?:legally|by law|under (?:the )?(?:law|statute))\s*,?\s*you\s+(?:must|do not have to|don't have to|don’t have to|are not required|aren't required|are required|can|cannot|can't|need to|may|are allowed|are not allowed)\b/i, { negatable: false }),
  R("legal.is-legal", "legal_advice", "Concludes that something is legal, illegal or enforceable", /\b(?:this|that|it|your (?:loan|structure|deal|plan)|the (?:loan|structure|deal|plan))\s+(?:is|would be|will be|isn't|is not|isn’t)\s+(?:perfectly |completely |entirely |totally |fully )?(?:legal|illegal|lawful|unlawful|enforceable|unenforceable|legally (?:binding|compliant|sound))\b/i, { negatable: false }),
  R("legal.sue", "legal_advice", "Advises litigation", /\byou\s+(?:should|can|could|ought to)\s+(?:sue|file (?:a )?(?:lawsuit|complaint|claim|suit))\b/i),
  R("legal.attorney-role", "legal_advice", "Presents itself as an attorney or gives a legal opinion", /\b(?:as your (?:attorney|lawyer|counsel)|(?:my|our) (?:legal )?(?:opinion|legal advice)\b|i(?:'m|’m| am) (?:an |your )?(?:attorney|lawyer)\b|this is legal advice)/i),
  R("legal.no-counsel", "legal_advice", "Discourages the borrower from consulting counsel or a CPA", /\b(?:no need|don't need|do not need|don’t need|not necessary|unnecessary)\b[^.]{0,30}\b(?:attorney|lawyer|counsel|cpa|accountant|tax advisor)\b/i, { negatable: false }),
  R("legal.tax-advice", "legal_advice", "Gives tax advice", /\b(?:you (?:can|should|may|will be able to) (?:deduct|write off|claim)\b|(?:this|that|it|the interest|the fees?) (?:is|are|will be|should be) (?:fully )?(?:tax[- ]deductible|deductible))|\b(?:is|are|will be|should be)\s+(?:fully |generally |usually |also |100% )?tax[- ]deductible\b/i),
  R("legal.securities", "legal_advice", "Gives securities-law conclusions", /\b(?:this|that|it) (?:is|isn't|is not|isn’t) (?:a |not a )?(?:security|securities offering)\b|\b(?:exempt from|no need for) securities (?:registration|laws?)\b/i, { negatable: false }),

  // --- usury ----------------------------------------------------------------------------
  R(
    "usury.loan-exempt",
    "usury_exemption",
    "Says a specific loan is exempt from usury limits",
    // Up to three modifier tokens before the loan noun; \S+ (not \w+) so a rate or
    // amount ("your 12% bridge", "this $3M 11.5% note") still counts as a modifier.
    // Positive verbs take an exemption predicate ("is exempt", "is not subject to ... usury");
    // negated verbs ("isn't", "won't be") take "subject to ... usury" directly. "Falls outside /
    // beyond" usury or interest-rate limits is the same claim.
    /\b(?:your|this|that|the|such an?)\s+(?:\S+\s+){0,3}(?:loan|deal|financing|transaction|rate|structure|facility|note|bridge|refinance)\b[^.]{0,40}?(?:\b(?:is|are|will be|would be|should be|looks|appears|seems)\s+(?:to be\s+)?(?:fully |likely |probably |generally |automatically |clearly |also )?(?:exempt\b|usury[- ]exempt\b|(?:outside|not subject to|immune from|beyond)\b[^.]{0,30}\busury|covered by (?:the )?(?:broker )?exemption)|\b(?:isn't|isn’t|is not|aren't|aren’t|are not|won't be|won’t be|will not be|wouldn't be|wouldn’t be|would not be|shouldn't be|shouldn’t be|should not be)\s+(?:fully |likely |probably |generally |automatically |clearly |also |even )?(?:subject to|bound by|governed by)\b[^.]{0,30}\busury|\b(?:falls?|fell|sits?|is|are)\s+(?:completely |entirely |fully |well |safely )?(?:outside|beyond)\b[^.]{0,30}\b(?:usury|interest[- ]rate (?:caps?|limits?|ceilings?)))|\bexempt from (?:california(?:'s|’s)? |the )?(?:usury|interest[- ]rate cap)/i,
    { negateInside: false, requires: /\b(?:your|this|that|the|such an?)\s+(?:\S+\s+){0,3}(?:loan|deal|financing|transaction|rate|structure|facility|note|bridge|refinance)\b|\byou(?:r)?\b/i },
  ),
  // "The usury cap doesn't reach your loan because a broker arranged it."
  R(
    "usury.not-reach",
    "usury_exemption",
    "Says usury limits do not reach, cover or govern the borrower's loan",
    /\busury\s+(?:caps?|limits?|laws?|ceilings?|rules?|statutes?)\b[^.]{0,30}?\b(?:doesn't|doesn’t|does not|don't|don’t|do not|won't|won’t|will not|wouldn't|wouldn’t|would not)\s+(?:reach|cover|govern|touch|apply to|affect)\b/i,
    { negateInside: false, requires: LOAN_REF },
  ),
  R("usury.not-apply", "usury_exemption", "Says usury limits do not apply to the borrower's loan", /\busury\b[^.]{0,60}\b(?:doesn't|does not|won't|will not|isn't|is not|don't|do not|don’t|doesn’t|aren't|are not)\s+(?:apply|a (?:concern|issue|problem)|an? (?:issue|concern|problem)|matter)\b/i, { negateInside: false, requires: LOAN_REF }),
  // "qualifies for / falls under / is covered by ... the broker exemption" about the borrower's loan.
  R(
    "usury.qualifies-for-exemption",
    "usury_exemption",
    "Says the borrower's loan qualifies for, falls under or is covered by an exemption",
    /\b(?:qualif(?:y|ies|ied)|falls? (?:under|within)|fell (?:under|within)|(?:is |are |be )?covered by|eligible for|benefits? from)\b(?:[^.]|\.(?=\d)){0,40}\bexemption\b/i,
    { requires: BORROWER_LOAN_REF },
  ),
  // "§1916.1 / the broker exemption applies to / exempts / covers your loan".
  R(
    "usury.exemption-applies",
    "usury_exemption",
    "Says §1916.1 or the broker exemption applies to, exempts or covers the borrower's loan",
    /\b(?:1916\.1|broker(?:[- ]arrang(?:ed|ement))? exemption|usury exemption)\b(?:[^.]|\.(?=\d)){0,40}\b(?:applies|apply|exempts|covers)\b/i,
    { requires: BORROWER_LOAN_REF },
  ),
  // "The 12% rate on your bridge loan is fine under California usury law."
  R(
    "usury.fine-under-law",
    "usury_exemption",
    "Says the borrower's rate or loan is fine or permitted under usury law",
    /\b(?:is|are|will be|would be|should be|looks|seems)\s+(?:perfectly |totally |completely |fully |probably |likely )?(?:fine|ok|okay|allowed|permitted|permissible|acceptable|compliant|legal|safe|good)\s+(?:under|with|for)\s+(?:the\s+)?(?:state\s+)?(?:california(?:'s|’s)?\s+)?(?:usury|interest[- ]rate (?:cap|limits?))/i,
    { negateInside: false, requires: BORROWER_LOAN_REF },
  ),
  R("usury.worry", "usury_exemption", "Tells the borrower not to worry about usury", /\b(?:won't|will not|don't|do not|don’t|wouldn't|need not|not)\s+(?:have to |need to )?(?:worry|be concerned)\s+about\s+(?:california |the )?usury\b|\b(?:no|nothing to) (?:usury|usury concerns?|usury risk)\b/i, { negatable: false }),
  R("usury.adjective", "usury_exemption", "Calls a loan usury-exempt", /\busury[- ]exempt\b/i, { requires: LOAN_REF }),

  // --- timelines -------------------------------------------------------------------------
  R("timeline.guarantee", "guaranteed_timeline", "Guarantees a closing or funding timeline", /\bguarantee[sd]?\b[^.]{0,50}\b(?:clos|fund|timeline|timing|schedule|in \d+|within \d+|by )/i),
  // The same claim with "guaranteed" after the timeline ("most loans close in 10 days, guaranteed"). The
  // SBA's guarantee on a loan ("SBA-guaranteed portion", "guaranteed by the SBA") is not a timeline.
  R(
    "timeline.guaranteed-after",
    "guaranteed_timeline",
    "States a closing or funding time, then calls it guaranteed",
    /\b(?:clos|fund)\w*\b[^.]{0,40}(?<![-\w])guaranteed\b(?!\s+(?:portion|share|piece|percentage|amount|part|loans?|by)\b)/i,
  ),
  R(
    "timeline.will-close-in",
    "guaranteed_timeline",
    "States a firm closing or funding time",
    /\b(?:will|is going to|are going to|'ll|’ll|guaranteed to|definitely will|will definitely|will certainly|is sure to|are sure to)\s+(?:definitely |certainly |surely |absolutely )?(?:(?:close|fund)(?:\s+(?:your|the|this|that)\s+(?:\S+\s+){0,2}?(?:loan|deal|financing|bridge|refinance|transaction|purchase|acquisition))?|be funded|be closed|be done|be completed|be finished|be in your account)\s+(?:in|within|by|before|on)\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|forty|sixty|ninety|a (?:week|month|day)|next|the end of|end of|[A-Z][a-z]+ \d)/i,
  ),
  // Present-tense or "expect" forms: "Your loan closes in 14 days", "Funding takes 5 days",
  // "You can expect funding in 7 days", "We close loans in 10 days".
  R(
    "timeline.closes-in",
    "guaranteed_timeline",
    "States a closing or funding time as a fact",
    new RegExp(
      String.raw`\b(?:(?:your|the|this) (?:loan|deal|financing|bridge|refinance)|we|kubera|funding|closing|you(?:'ll|’ll|\s+(?:can|should|will|could|may))?)\s+(?:(?:closes?|funds?)(?:\s+(?:(?:your|the|most|all|these|our|such)\s+)?(?:[\w-]+\s+)?(?:loans?|deals?|financing|bridges?|it|them))?|takes|(?:will |can )?expects?\s+(?:to close|to fund|to be funded|funding|closing|to have (?:funding|the funds))|(?:is|are) (?:done|complete|completed|finished))\s+(?:(?:in|within)\s+)?${DURATION}`,
      "i",
    ),
    { unlessUnit: TIMELINE_HEDGE },
  ),
  R("timeline.closing-certain", "guaranteed_timeline", "Says closing is certain or fixed", /\b(?:closing|close|funding)(?: date| timeline)?\s+(?:is|will be)\s+(?:guaranteed|assured|certain|locked in|fixed|firm)\b/i),
  R("timeline.get-you-closed", "guaranteed_timeline", "Promises a closing date", /\b(?:we|kubera)(?:'ll|’ll| will| can)\s+(?:definitely |certainly )?(?:get|have)\s+(?:you|your (?:loan|deal|financing))\s+(?:closed|funded)\s+(?:in|within|by|before)\b/i),

  // --- broker-only role (Global rule 1) --------------------------------------------------
  R("role.kubera-lends", "broker_role", "Presents Kubera as the lender, originator or servicer", /\b(?:we|kubera(?: commercial)?)(?:'ll|’ll)?\s+(?:will |can |would |also |directly |ourselves )?(?:fund|lend|originate|service|underwrite and fund)s?\b|\b(?:we|kubera(?: commercial)?)(?:'ll|’ll)?\s+(?:are|is|act as|serve as|be|will be|will act as|would be)\s+(?:the |your |a )?(?:direct )?(?:lender|originator|servicer|beneficiary)\b|\bour (?:own )?(?:balance sheet|lending (?:arm|program)|loan fund)\b/i),
  R(
    "role.holds-funds",
    "broker_role",
    "Says Kubera holds, receives or disburses money",
    new RegExp(
      // "proof of funds" is a document, and "payment history / terms" are information, not money.
      String.raw`\b${KUBERA_SUBJECT}\s+(?:will |can |would |also )?(?:hold|collect|accept|receive|disburse|release|escrow|wire)s?\s+${MODIFIERS}(?<!\bof\s)(?:deposits?|funds|money|earnest|payments?|escrow|proceeds|draws?|retainers?)\b(?!\s+(?:history|terms?|schedules?|information|info|details|records?|options|structure|calculations?|estimates?|amounts?|letters?|statements?))|` +
        String.raw`\b(?:send|wire|deposit|transfer)\b[^.]{0,40}\bto (?:us|kubera(?: commercial)?)\b|\bto (?:our|kubera's|kubera’s) (?:trust|escrow|client|bank) account\b`,
      "i",
    ),
  ),
  R(
    "role.draws",
    "broker_role",
    "Says Kubera manages or processes construction draws",
    new RegExp(
      String.raw`\b${KUBERA_SUBJECT}\s+(?:will |can |also )?(?:process|manage|handle|inspect|review|approve|fund|service|administer|oversee|disburse|release|order|run|schedule|coordinate)(?:s|es)?\s+${MODIFIERS}(?:draws?|draw (?:process|inspections?|requests?|schedules?|funding|disbursements?))\b|` +
        String.raw`\bdraw (?:inspections?|servicing|pre-?checks?)\s+(?:are|is) (?:included|handled|provided) (?:by|with) (?:us|kubera)\b`,
      "i",
    ),
  ),

  // --- disclosure waiver ----------------------------------------------------------------------
  R("disclosure.mlds-not-needed", "disclosure_waiver", "Says the MLDS (RE 882) is not required", /\b(?:mlds|re ?882|mortgage loan disclosure statement)\b[^.]{0,50}\b(?:isn't|is not|isn’t|not|won't be|won’t be|no longer|never)\s+(?:be )?(?:required|needed|necessary)\b|\b(?:no|skip the|without an?|(?:don't|do not|don’t|doesn't|does not|doesn’t|won't|won’t|will not|wouldn't|wouldn’t|would not|shouldn't|shouldn’t)\s+(?:need|require)(?:\s+to\s+(?:sign|get|receive|provide))?\s+(?:an?|the))\s+(?:mlds|re ?882|mortgage loan disclosure statement)\b/i, { negatable: false }),

  // --- prohibited copy (Global rule 4) ----------------------------------------------------------
  R("copy.fees-protected", "prohibited_copy", "Claims fees are protected", /\bfees?\s+(?:are |is |will be |remain |stay )?protected\b|\bprotected fees?\b/i),
  R("copy.call-today", "prohibited_copy", "Promises a call today", /\b(?:will|'ll|’ll)\s+call you (?:today|within the hour|right away|this afternoon)\b/i),
  R("copy.autonomous", "prohibited_copy", "Describes Kubera as autonomous", /\b(?:kubera|our (?:ai|advisor|platform|system)|the (?:ai|system|platform))\b[^.]{0,40}\bautonomous(?:ly)?\b|\bfully autonomous\b|\bautonomous (?:ai |lending |underwriting |advisor)/i),
];

/** What replaces a unit that tripped a rule. Fixed text, written to comply with Global rules 1 and 4. */
export const SAFE_REPLACEMENTS: Record<GuardrailCategory, string> = {
  commitment: "Kubera can't promise approval, pricing, a rate lock or a particular lender; everything here is indicative and subject to lender underwriting.",
  legal_advice: "That is a legal or tax question, so please confirm it with your own attorney or CPA.",
  usury_exemption:
    "Whether any California usury exemption applies depends on the lender, the collateral and how the loan is arranged, so please confirm it with your attorney; Kubera can't say that a specific loan is exempt.",
  guaranteed_timeline: "Timing depends on the program, lender approval, appraisal, title and diligence after a complete file, and it is not guaranteed.",
  broker_role: "Kubera is a licensed California real estate broker, not a lender: it arranges financing, and it doesn't fund loans, hold money, service loans or handle construction draws.",
  disclosure_waiver: "California requires a Mortgage Loan Disclosure Statement (RE 882) on loans Kubera arranges that are secured by real property; your advisor will confirm what applies to your loan.",
  prohibited_copy: "A Kubera advisor reviews every engagement and can walk you through fees and next steps; Kubera's service is advisor-led and AI-assisted.",
};

export type GuardrailViolation = {
  ruleId: string;
  category: GuardrailCategory;
  /** The offending sentence as generated (trimmed, capped). Internal review only; never shown to the borrower. */
  excerpt: string;
  /** True when the unit was replaced in the output. */
  replaced: boolean;
};

export type GuardrailMode = "enforce" | "monitor";

/** AI_GUARDRAILS_MODE: "monitor" records hits without changing the reply; anything else enforces. */
export function guardrailMode(env: Record<string, string | undefined> = process.env): GuardrailMode {
  return env.AI_GUARDRAILS_MODE?.trim().toLowerCase() === "monitor" ? "monitor" : "enforce";
}

const EXCERPT_MAX = 300;

function clauseStart(unit: string, matchIndex: number): number {
  let start = 0;
  CLAUSE_BREAK.lastIndex = 0;
  for (let m = CLAUSE_BREAK.exec(unit); m && m.index < matchIndex; m = CLAUSE_BREAK.exec(unit)) start = m.index + m[0].length;
  return start;
}

function suppressed(rule: GuardrailRule, unit: string, match: RegExpExecArray): boolean {
  const start = clauseStart(unit, match.index);
  const before = unit.slice(start, match.index);
  // A conditional lead-in makes an approval hypothetical ("once you're approved ...").
  if (CONDITIONAL.test(unit.slice(0, match.index))) return true;
  if (rule.negatable === false) return false;
  // A negator before or inside the match, in the same clause, makes it a disclaimer.
  return NEGATOR.test(before) || (rule.negateInside !== false && NEGATOR.test(match[0]));
}

/** Rules a unit of text trips. Pure. */
export function checkUnit(unit: string): { rule: GuardrailRule; match: string }[] {
  const hits: { rule: GuardrailRule; match: string }[] = [];
  for (const rule of GUARDRAIL_RULES) {
    if (rule.requires && !rule.requires.test(unit)) continue;
    if (rule.unlessUnit?.test(unit)) continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (let m = re.exec(unit); m; m = re.exec(unit)) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      if (!suppressed(rule, unit, m)) {
        hits.push({ rule, match: m[0] });
        break;
      }
    }
  }
  return hits;
}

/** When one unit trips several categories, the most specific replacement wins; the general commitment one is last. */
const CATEGORY_PRIORITY: readonly GuardrailCategory[] = ["usury_exemption", "guaranteed_timeline", "broker_role", "disclosure_waiver", "legal_advice", "prohibited_copy", "commitment"];

const LIST_PREFIX = /^(\s*(?:[-*+•]|\d{1,2}[.)]|#{1,6}|>)\s+)/;

export type CheckResult = {
  ok: boolean;
  violations: GuardrailViolation[];
  /** The text with offending units replaced (equal to the input in monitor mode or when ok). */
  text: string;
};

/** Checks a complete reply at once (non-streaming callers, evals and tests). */
export function checkText(text: string, opts: { mode?: GuardrailMode } = {}): CheckResult {
  const filter = new GuardrailStreamFilter(opts);
  const out = filter.push(text) + filter.flush();
  return { ok: filter.violations.length === 0, violations: filter.violations, text: out };
}

/** Longest a unit may grow before it is checked without a sentence end (a long table row, say). */
const MAX_UNIT = 1_500;

/** Sentence or line ends: terminal punctuation (plus closers) followed by whitespace, or a newline. */
const BOUNDARY = /[.!?]["')\]*_]*\s|\n/g;

/**
 * Streaming filter. `push` takes model text deltas and returns the text that
 * is safe to send on; `flush` returns whatever is left at the end of the reply.
 * Text only leaves once its sentence has ended, so a delay of at most one
 * sentence is added.
 */
export class GuardrailStreamFilter {
  readonly violations: GuardrailViolation[] = [];
  private buffer = "";
  private readonly mode: GuardrailMode;
  private lastReplacementCategory: GuardrailCategory | null = null;

  constructor(opts: { mode?: GuardrailMode } = {}) {
    this.mode = opts.mode ?? "enforce";
  }

  push(delta: string): string {
    this.buffer += delta;
    let out = "";
    for (;;) {
      const cut = this.nextCut();
      if (cut === -1) break;
      out += this.process(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
    }
    return out;
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest ? this.process(rest) : "";
  }

  /** Index just past the first complete unit in the buffer, or -1. */
  private nextCut(): number {
    BOUNDARY.lastIndex = 0;
    const m = BOUNDARY.exec(this.buffer);
    if (m) {
      // A sentence end needs a following non-space character to be sure it is not a
      // decimal or abbreviation split mid-token; whitespace was already required.
      return m.index + m[0].length;
    }
    if (this.buffer.length >= MAX_UNIT) {
      const space = this.buffer.lastIndexOf(" ", MAX_UNIT);
      return space > 0 ? space + 1 : MAX_UNIT;
    }
    return -1;
  }

  private process(unit: string): string {
    if (!unit.trim()) return unit;
    const hits = checkUnit(unit);
    if (hits.length === 0) {
      this.lastReplacementCategory = null;
      return unit;
    }
    const replaced = this.mode === "enforce";
    const excerpt = unit.trim().slice(0, EXCERPT_MAX);
    for (const h of hits) this.violations.push({ ruleId: h.rule.id, category: h.rule.category, excerpt, replaced });
    if (!replaced) return unit;

    const category = CATEGORY_PRIORITY.find((c) => hits.some((h) => h.rule.category === c))!;
    const lead = LIST_PREFIX.exec(unit)?.[1] ?? unit.match(/^\s*/)![0];
    const trail = unit.match(/\s*$/)![0];
    // Two bad sentences in a row produce one safe sentence, not two copies.
    if (this.lastReplacementCategory === category) return trail;
    this.lastReplacementCategory = category;
    return `${lead}${SAFE_REPLACEMENTS[category]}${trail || " "}`;
  }
}

export type GuardrailReport = {
  mode: GuardrailMode;
  violations: GuardrailViolation[];
  /** Distinct categories hit, for flags and filters. */
  categories: GuardrailCategory[];
};

export function summarizeViolations(violations: readonly GuardrailViolation[], mode: GuardrailMode): GuardrailReport {
  return { mode, violations: [...violations], categories: [...new Set(violations.map((v) => v.category))].sort() as GuardrailCategory[] };
}

/** Human-readable flag reason for a set of violations ("Commitment language, Guaranteed timeline"). */
export function flagReason(categories: readonly GuardrailCategory[]): string {
  return `Guardrail: ${categories.map((c) => GUARDRAIL_CATEGORY_LABELS[c]).join(", ")}`;
}
