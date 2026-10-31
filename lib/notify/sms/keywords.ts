// Inbound SMS keywords (CTIA / Telnyx 10DLC): STOP-class words opt out, HELP
// returns help text, START-class words opt back in. START and HELP must be the whole
// message; the main STOP words opt out when they lead the message so that
// "STOP calling me" is honored. When in doubt we opt the person out.

export type SmsKeyword = "stop" | "help" | "start";

// Words that opt out wherever they lead the message ("STOP calling me") ...
const STOP_LEADING = new Set(["stop", "stopall", "unsubscribe", "quit", "optout"]);
// ... and words that opt out only when they are the whole message ("CANCEL" but not "cancel the appraisal").
const STOP_EXACT = new Set(["cancel", "end", "revoke"]);
const HELP_WORDS = new Set(["help", "info"]);
const START_WORDS = new Set(["start", "unstop"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function parseKeyword(text: string): SmsKeyword | null {
  const w = words(text);
  const first = w[0];
  if (!first) return null;
  // "opt out", "opt-out"
  if (first === "opt" && w[1] === "out") return "stop";
  if (STOP_LEADING.has(first) || (w.length === 1 && STOP_EXACT.has(first))) return "stop";
  if (w.length === 1 && HELP_WORDS.has(first)) return "help";
  if (w.length === 1 && START_WORDS.has(first)) return "start";
  return null;
}

/** Wording recorded in the consent ledger for a person who texts START. Never edit a published version; add a new one. */
export const SMS_START_CONSENT = {
  id: "sms-start-keyword-2026-11-03",
  text: "I texted START to Kubera Commercial and agree to receive text messages about my financing request. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
} as const;

/** Wording recorded when a person texts STOP. */
export const SMS_STOP_NOTICE = {
  id: "sms-stop-keyword-2026-11-03",
  text: "The person texted a STOP-class keyword to Kubera Commercial and revoked consent to text messages and automated contact.",
} as const;
