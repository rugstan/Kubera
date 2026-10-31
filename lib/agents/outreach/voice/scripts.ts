import { createHash } from "node:crypto";
import { site } from "@/lib/site";
import type { VoiceMode } from "./types";

// Call scripts and the mandatory disclosures. A script is versioned like a
// message template; editing the wording means a new version, and a broker's
// approval names the script version and hash. The disclosures are fixed text
// that plays before anything else and cannot be left out of a call plan.

/** Opens every AI-voice call, before anything else. */
export const AI_VOICE_DISCLOSURE = `Hello. This is an automated assistant calling for ${site.name}, a licensed real estate loan broker. I am an AI voice, not a person.`;

/** Plays before a recording starts. The recording does not begin until this has finished. */
export const RECORDING_DISCLOSURE = "This call will be recorded for quality and record keeping. Please stay on the line if that is all right. If you would rather not be recorded, tell us now and we will not record.";

export type VoiceScript = {
  id: string;
  version: number;
  modes: readonly VoiceMode[];
  /** Spoken after the disclosures. */
  body: (data: ScriptData) => string;
  sample: ScriptData;
};

export type ScriptData = { firstName?: string | null; count?: number | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SCRIPTS: readonly VoiceScript[] = [
  {
    id: "document_followup",
    version: 1,
    modes: ["ai_voice"],
    sample: { firstName: "Pat", count: 3 },
    body: (d) =>
      `${d.firstName ? `Hi ${d.firstName}. ` : ""}Your advisor is still waiting on ${d.count ? plural(d.count, "item", "items") : "a few items"} for your financing request. ${
        site.phone ? `You can reach your advisor at ${site.phone}, or reply to the email we sent.` : "You can reply to the email we sent."
      } Thank you.`,
  },
  {
    id: "advisor_introduction",
    version: 1,
    modes: ["ai_voice"],
    sample: { firstName: "Pat" },
    body: (d) =>
      `${d.firstName ? `Hi ${d.firstName}. ` : ""}Thanks for your financing request. An advisor is reviewing it and would like to talk it through with you. ${
        site.phone ? `You can reach your advisor at ${site.phone}, or reply to the email we sent.` : "You can reply to the email we sent."
      } Thank you.`,
  },
  {
    id: "human_bridge",
    version: 1,
    modes: ["human_assisted"],
    sample: {},
    body: () => `Please hold while I connect you to your advisor at ${site.name}.`,
  },
];

const BY_ID = new Map(SCRIPTS.map((s) => [s.id, s]));

export function scriptById(id: string): VoiceScript | null {
  return BY_ID.get(id) ?? null;
}

export const allScripts = (): readonly VoiceScript[] => SCRIPTS;

/** What the call says, in order: disclosures first, then the script body. */
export function callPrelude(mode: VoiceMode, recording: boolean): string {
  return [mode === "ai_voice" ? AI_VOICE_DISCLOSURE : null, recording ? RECORDING_DISCLOSURE : null].filter(Boolean).join(" ");
}

/** Hash of the call's complete wording, so an approval names exactly what will be said. */
export function scriptFingerprint(script: VoiceScript, mode: VoiceMode, recording: boolean): string {
  return createHash("sha256").update(`${script.id}@${script.version}\n${mode}\n${callPrelude(mode, recording)}\n${script.body(script.sample)}`).digest("hex");
}
