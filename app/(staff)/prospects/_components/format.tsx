import { Badge } from "@/app/(staff)/deals/ui";
import { OUTREACH_STATUS_LABELS, PROPERTY_TYPE_LABELS, PROSPECT_PROGRAM_LABELS, PROSPECT_STATUS_LABELS, WINDOW_BUCKET_LABELS, type OutreachStatus, type Prospect, type ProspectStatus } from "@/lib/agents/intel/types";

export const programLabel = (p: Prospect["recommendedProgram"]) => (p ? PROSPECT_PROGRAM_LABELS[p] : "Not set");
export const windowLabel = (w: Prospect["windowBucket"]) => WINDOW_BUCKET_LABELS[w];
export const typeLabel = (p: Pick<Prospect, "propertyType" | "units">) => `${PROPERTY_TYPE_LABELS[p.propertyType]}${p.units ? `, ${p.units} units` : ""}`;

export function dollars(cents: number | null): string {
  if (cents === null) return "Unknown";
  const d = cents / 100;
  return d >= 1_000_000 ? `$${(d / 1_000_000).toFixed(d >= 10_000_000 ? 1 : 2)}M` : `$${Math.round(d).toLocaleString("en-US")}`;
}

export function day(iso: string | null): string {
  if (!iso) return "Unknown";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

const STATUS_TONE: Record<ProspectStatus, "neutral" | "good" | "warn" | "bad"> = { new: "neutral", reviewing: "neutral", drafted: "warn", contacted: "good", engaged: "good", not_a_fit: "neutral", do_not_contact: "bad" };

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PROSPECT_STATUS_LABELS[status]}</Badge>;
}

const OUTREACH_TONE: Record<OutreachStatus, "neutral" | "good" | "warn" | "bad"> = { pending_approval: "warn", sent: "good", ready_to_mail: "good", mailed: "good", rejected: "bad", expired: "bad", failed: "bad", blocked: "bad", cancelled: "neutral" };

export function OutreachBadge({ status }: { status: OutreachStatus }) {
  return <Badge tone={OUTREACH_TONE[status]}>{OUTREACH_STATUS_LABELS[status]}</Badge>;
}

/** Score as a number with a bar; the text carries the meaning, the bar is decoration. */
export function ScoreBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-8 text-right text-sm font-semibold tabular-nums text-ink">{score}</span>
      <span aria-hidden="true" className="block h-1.5 w-16 overflow-hidden rounded-full bg-black/10">
        <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}
