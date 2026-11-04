// Inbound SMS keywords (CTIA / Telnyx 10DLC): STOP-class words opt out, HELP
// returns help text, START-class words opt back in. START and HELP must be the
// whole message.
//
// Revocation is honored however it is phrased (FCC revocation rule, 47 CFR
// 64.1200(a)(10), in force since 2025-04-11): a message that contains a
// STOP-class word anywhere ("Please stop texting me", "cancel my texts") or a
// plain "don't text me" request revokes consent. When the opt-out word is not the
// whole or leading message, the revocation is still recorded and staff also get
// the text so they can follow up on anything else it says ("cancel the
// appraisal"). When in doubt we opt the person out.

export type SmsKeyword = "stop" | "help" | "start";

/** STOP-class words; any one of them anywhere in a message revokes text consent. */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "quit", "optout", "cancel", "end", "revoke"]);
// Words that opt out on their own when they lead the message ("STOP calling me").
const STOP_LEADING = new Set(["stop", "stopall", "unsubscribe", "quit", "optout"]);
const HELP_WORDS = new Set(["help", "info"]);
const START_WORDS = new Set(["start", "unstop"]);

/** Free-form revocations with no STOP-class word ("Don't text me again", "remove me from your list"). */
const REVOCATION_PHRASES = [
  /\b(?:dont|do not|never|no more|no longer)\s+(?:ever\s+|again\s+)?(?:text|txt|texts|texting|message|messages|messaging|sms|contact)\b/,
  /\b(?:remove|take)\s+(?:me|my (?:number|phone|cell))\s+(?:off|from)\b/,
  /\bopt\s+me\s+out\b/,
  // The person at this number never agreed to texts.
  /\bwrong (?:number|person)\b/,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type InboundKeyword = {
  keyword: SmsKeyword | null;
  /**
   * True when the message revokes consent but is not a plain keyword ("Please
   * stop texting me"): the revocation is recorded and staff still see the text.
   */
  embeddedRevocation: boolean;
};

export function classifyInbound(text: string): InboundKeyword {
  const norm = normalize(text);
  const w = norm ? norm.split(" ") : [];
  const first = w[0];
  if (!first) return { keyword: null, embeddedRevocation: false };
  // Leading or whole-message STOP keyword: "STOP", "opt out", "STOP calling me", "CANCEL".
  if ((first === "opt" && w[1] === "out") || STOP_LEADING.has(first) || (w.length === 1 && STOP_WORDS.has(first))) {
    return { keyword: "stop", embeddedRevocation: false };
  }
  if (w.length === 1 && HELP_WORDS.has(first)) return { keyword: "help", embeddedRevocation: false };
  if (w.length === 1 && START_WORDS.has(first)) return { keyword: "start", embeddedRevocation: false };
  // A STOP-class word anywhere, "opt out" anywhere, or a free-form "don't text me".
  const anywhere = w.some((x) => STOP_WORDS.has(x)) || w.some((x, i) => x === "opt" && w[i + 1] === "out") || REVOCATION_PHRASES.some((re) => re.test(norm));
  return anywhere ? { keyword: "stop", embeddedRevocation: true } : { keyword: null, embeddedRevocation: false };
}

export function parseKeyword(text: string): SmsKeyword | null {
  return classifyInbound(text).keyword;
}

/** Wording recorded in the consent ledger for a person who texts START. Never edit a published version; add a new one. */
export const SMS_START_CONSENT = {
  id: "sms-start-keyword-2026-11-03",
  text: "I texted START to Corin Commercial and agree to receive text messages about my financing request. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
} as const;

/** Wording recorded when a person texts STOP. */
export const SMS_STOP_NOTICE = {
  id: "sms-stop-keyword-2026-11-03",
  text: "The person texted a STOP-class keyword to Corin Commercial and revoked consent to text messages and automated contact.",
} as const;
