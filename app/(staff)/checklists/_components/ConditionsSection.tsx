import { CONDITION_MOVES, CONDITION_SOURCES, CONDITION_TIMING, TIMING_LABEL, type Condition, type ConditionStatus } from "@/lib/checklists/conditions";
import type { DealChecklistItem } from "@/lib/checklists/types";
import { addConditionAction, moveConditionAction } from "../actions";
import { Badge, Card } from "./ui";

const TONE: Record<ConditionStatus, "good" | "warn" | "bad" | "muted"> = { open: "warn", submitted: "warn", rejected: "bad", cleared: "good", waived: "good" };

export function ConditionsSection({ dealId, conditions, items }: { dealId: string; conditions: Condition[]; items: DealChecklistItem[] }) {
  return (
    <Card id="conditions" title="Conditions">
      {conditions.length === 0 ? <p className="text-[15px] text-ink/80">No conditions yet. Add the lender of record&apos;s conditions as they arrive.</p> : null}
      <ul>
        {conditions.map((c) => (
          <li key={c.id} className="border-t border-black/10 py-4 first:border-t-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold">{c.description}</p>
                <p className="mt-0.5 text-[13px] text-ink/80">
                  {c.source === "lender" ? c.lenderName : c.source.toUpperCase()} · {TIMING_LABEL[c.timing]} · {c.responsible.replace("_", " ")}
                  {c.dueDate ? ` · due ${c.dueDate}` : ""}
                </p>
                {c.waiverReason ? <p className="mt-1 text-[13px]">Waived: {c.waiverReason} ({c.waiverEvidence ?? "Corin condition"})</p> : null}
                {c.notes ? <p className="mt-1 text-[13px]">Notes: {c.notes}</p> : null}
              </div>
              <Badge tone={TONE[c.status]}>{c.status}</Badge>
            </div>
            <form action={moveConditionAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_2fr_auto] sm:items-end">
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="conditionId" value={c.id} />
              <input type="hidden" name="version" value={c.version} />
              <div>
                <label className="field-label" htmlFor={`cto-${c.id}`}>Change to</label>
                <select id={`cto-${c.id}`} name="to" className="field">
                  {CONDITION_MOVES[c.status].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor={`cnote-${c.id}`}>Note or waiver reason</label>
                <input id={`cnote-${c.id}`} name="note" className="field" />
              </div>
              <div>
                <label className="field-label" htmlFor={`cev-${c.id}`}>Written waiver (email or letter)</label>
                <input id={`cev-${c.id}`} name="waiverEvidence" className="field" />
              </div>
              <button type="submit" className="pill pill-glass !py-2 !text-[15px]">Update</button>
            </form>
          </li>
        ))}
      </ul>

      <details className="mt-4 rounded-xl border border-black/10 p-4">
        <summary className="cursor-pointer text-[15px] font-medium">Add a condition</summary>
        <form action={addConditionAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="dealId" value={dealId} />
          <div className="sm:col-span-3">
            <label className="field-label" htmlFor="cond-desc">Condition</label>
            <input id="cond-desc" name="description" required minLength={5} className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="cond-source">Set by</label>
            <select id="cond-source" name="source" className="field">
              {CONDITION_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="cond-lender">Lender of record (if set by lender)</label>
            <input id="cond-lender" name="lenderName" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="cond-timing">Timing</label>
            <select id="cond-timing" name="timing" defaultValue="prior_to_closing" className="field">
              {CONDITION_TIMING.map((t) => (
                <option key={t} value={t}>
                  {TIMING_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="cond-resp">Responsible</label>
            <select id="cond-resp" name="responsible" className="field">
              <option value="borrower">Borrower</option>
              <option value="corin">Corin</option>
              <option value="lender">Lender of record</option>
              <option value="vendor">Vendor</option>
              <option value="title_escrow">Title / escrow</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="cond-due">Due</label>
            <input id="cond-due" name="dueDate" type="date" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="cond-item">Checklist item (optional)</label>
            <select id="cond-item" name="checklistItemId" className="field">
              <option value="">None</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="pill pill-primary !py-2 !text-[15px] sm:col-span-3 sm:justify-self-start">Add condition</button>
        </form>
      </details>
    </Card>
  );
}
