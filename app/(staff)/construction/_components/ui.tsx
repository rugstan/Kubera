import type { ReactNode } from "react";
import type { LicenseReadiness } from "@/lib/construction/service";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/lib/construction/types";

type Tone = "good" | "warn" | "bad" | "neutral";

const TONES: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-900 ring-emerald-700/30",
  warn: "bg-amber-50 text-amber-900 ring-amber-700/30",
  bad: "bg-rose-50 text-rose-900 ring-rose-700/30",
  neutral: "bg-black/5 text-ink ring-black/15",
};

/** Status chip. The label always says the state in words; colour only reinforces it. */
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function ReportStatusChip({ status, overdue = false }: { status: ReportStatus; overdue?: boolean }) {
  const tone: Tone = overdue || status === "order_blocked" ? "bad" : status === "accepted" ? "good" : status === "not_ordered" || status === "cancelled" ? "neutral" : "warn";
  return <Chip tone={tone}>{overdue ? `${REPORT_STATUS_LABELS[status]} (overdue)` : REPORT_STATUS_LABELS[status]}</Chip>;
}

const LICENSE_TEXT: Record<LicenseReadiness, [Tone, string]> = {
  verified: ["good", "License verified"],
  issues: ["bad", "License issues"],
  stale: ["warn", "Check is over 30 days old"],
  not_checked: ["neutral", "Not checked"],
  unverifiable: ["warn", "Could not verify"],
};

export function LicenseChip({ state }: { state: LicenseReadiness }) {
  const [tone, label] = LICENSE_TEXT[state];
  return <Chip tone={tone}>{label}</Chip>;
}

export function Card({ title, id, lead, children, action }: { title: string; id?: string; lead?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="bento p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-xl font-semibold tracking-tight md:text-2xl">
            {title}
          </h2>
          {lead && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-titanium">{lead}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-titanium">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
      {note && <dd className="mt-0.5 text-[13px] text-titanium">{note}</dd>}
    </div>
  );
}

const dateTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDate(civil: string | null): string {
  if (!civil) return "Not set";
  const [y, m, d] = civil.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export function Notice({ tone = "neutral", title, children }: { tone?: Tone; title: string; children: ReactNode }) {
  return (
    <div role="note" className={`rounded-2xl px-4 py-3 text-[15px] ring-1 ring-inset ${TONES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-0.5 leading-relaxed">{children}</div>
    </div>
  );
}
