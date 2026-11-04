import type { ScreeningGate } from "@/lib/screening/policy";
import type { DealHold } from "@/lib/screening/store";
import type { ScreeningRecord } from "@/lib/screening/types";
import { dispositionAction, runScreeningAction } from "../actions";
import { Badge, Card } from "./ui";

const STATE_TONE = { clear: "good", unscreened: "muted", error: "bad", held: "bad", confirmed_match: "bad" } as const;
const STATE_LABEL = { clear: "Clear", unscreened: "Not screened", error: "Screening failed", held: "Possible match", confirmed_match: "Confirmed match" } as const;

export function ScreeningSection({ dealId, gate, screenings, holds, configured }: { dealId: string; gate: ScreeningGate; screenings: ScreeningRecord[]; holds: DealHold[]; configured: boolean }) {
  const review = screenings.filter((s) => s.result === "potential_match" && (s.disposition === "pending_review" || s.disposition === "escalated"));
  return (
    <Card id="screening" title="Sanctions screening (OFAC and other lists)">
      {!configured ? <p className="mb-3 text-[14px] text-warning">The screening provider is not configured (OPENSANCTIONS_API_KEY). Runs are recorded as failed and no one clears.</p> : null}
      {holds.length ? (
        <div role="alert" className="notice-danger mb-4 rounded-xl p-3 text-[14px]">
          <p className="font-semibold">This deal is on hold.</p>
          <ul className="mt-1 list-disc pl-5">
            {holds.map((h) => (
              <li key={h.id}>{h.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {gate.subjects.map((s) => (
          <li key={s.principalId} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-[14px]">
            <span>
              {s.name}
              {s.lastCleared ? <span className="block text-[12px] text-ink/80">Cleared {s.lastCleared.screenedAt.slice(0, 10)} · {s.lastCleared.listVersion}</span> : null}
            </span>
            <Badge tone={STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</Badge>
          </li>
        ))}
      </ul>
      {gate.blocking.length ? (
        <ul className="mt-3 list-disc pl-5 text-[13px]">
          {gate.blocking.map((b) => (
            <li key={b.principalId + b.reason}>
              {b.name}: {b.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <form action={runScreeningAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="dealId" value={dealId} />
        <div>
          <label className="field-label" htmlFor="scr-purpose">Run</label>
          <select id="scr-purpose" name="purpose" className="field">
            <option value="initial">Screen all principals</option>
            <option value="rescreen_pre_closing">Rescreen before closing</option>
          </select>
        </div>
        <button type="submit" className="pill pill-primary !py-2 !text-[15px]">Run screening</button>
      </form>

      {review.map((s) => (
        <div key={s.id} className="mt-5 rounded-xl border border-danger/40 p-4">
          <p className="text-[15px] font-semibold">
            Review: {s.subjectName} — score {s.matchScore ?? "n/a"} ({s.disposition.replace("_", " ")})
          </p>
          <p className="text-[13px] text-ink/80">
            {s.provider} · {s.listVersion} · screened {s.screenedAt.slice(0, 16).replace("T", " ")} UTC
          </p>
          <ul className="mt-2 list-disc pl-5 text-[13px]">
            {s.matches.slice(0, 5).map((m) => (
              <li key={m.entryId}>
                {m.name} ({m.entryId}) score {m.score} · lists {m.lists.join(", ") || "—"} · programs {m.programs.join(", ") || "—"} · born {m.birthDates.join(", ") || "—"} · {m.countries.join(", ") || "—"}
              </li>
            ))}
          </ul>
          {s.reviewNote ? <p className="mt-2 text-[13px]">Earlier note: {s.reviewNote}</p> : null}
          <form action={dispositionAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_3fr_auto] sm:items-end">
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="screeningId" value={s.id} />
            <div>
              <label className="field-label" htmlFor={`disp-${s.id}`}>Decision</label>
              <select id={`disp-${s.id}`} name="to" className="field">
                <option value="false_positive">Not the subject (false positive)</option>
                <option value="confirmed_match">Confirmed match</option>
                {s.disposition === "pending_review" ? <option value="escalated">Escalate</option> : null}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor={`dnote-${s.id}`}>Why (identifiers compared)</label>
              <input id={`dnote-${s.id}`} name="note" required minLength={10} className="field" />
            </div>
            <button type="submit" className="pill pill-glass !py-2 !text-[15px]">Record</button>
          </form>
        </div>
      ))}
    </Card>
  );
}
