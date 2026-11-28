import { Check, Submit } from "@/app/(staff)/deals/ui";
import { OVERRIDE_REASON_LENGTH, TARGET_STAGE_LABELS, targetStages, type TargetStage, type VaultDocumentRef } from "@/lib/deals/submission/types";
import type { PreviewLender } from "../_lib/data";

// The fields of a request for broker approval, shared by the preview page and
// the matching desk (which supplies its own ranked lender table as `lenderPicker`).

export function RequestFields({
  dealId,
  stage,
  documents,
  lenders,
  checkedLenderId,
  lenderPicker,
  missingCount,
  leadLinked,
}: {
  dealId: string;
  stage: TargetStage;
  documents: VaultDocumentRef[];
  lenders?: PreviewLender[];
  checkedLenderId?: string | null;
  lenderPicker?: React.ReactNode;
  missingCount: number;
  leadLinked: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input name="dealId" type="hidden" value={dealId} />
      {lenderPicker ? (
        <div className="min-w-0 sm:col-span-2">{lenderPicker}</div>
      ) : (
        <fieldset className="min-w-0 sm:col-span-2">
          <legend className="field-label">Lenders</legend>
          {lenders?.length ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {lenders.map((l) => (
                <label className="flex min-h-11 items-center gap-2 text-sm" key={l.id}>
                  <input className="size-4 accent-[var(--color-accent)]" defaultChecked={l.id === checkedLenderId} name="lenderId" type="checkbox" value={l.id} />
                  <span className="min-w-0 break-words">
                    {l.name}
                    {l.stale ? <span className="text-xs text-warning"> (verification stale)</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-titanium">No active panel lender has a recorded appetite for this program.</p>
          )}
        </fieldset>
      )}
      <label className="block min-w-0">
        <span className="field-label">Ask the lender for</span>
        <select className="field" defaultValue={stage} name="stage">
          {targetStages.map((s) => (
            <option key={s} value={s}>
              {TARGET_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0">
        <span className="field-label">Note for the approving broker</span>
        <input className="field" maxLength={300} name="note" type="text" />
      </label>
      <fieldset className="min-w-0 sm:col-span-2">
        <legend className="field-label">Vault documents (the deal summary is always included)</legend>
        {documents.length ? (
          <div className="grid gap-1 sm:grid-cols-2">
            {documents.map((d) => (
              <label className="flex min-h-11 items-center gap-2 text-sm" key={d.id}>
                <input className="size-4 accent-[var(--color-accent)]" defaultChecked name="documentId" type="checkbox" value={d.id} />
                <span className="min-w-0 break-words">
                  {d.fileName} <span className="text-xs text-titanium">({d.kind})</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-titanium">{leadLinked ? "No clean documents in the vault yet." : "Link the deal to its lead to package vault documents."}</p>
        )}
      </fieldset>
      <label className="block min-w-0 sm:col-span-2">
        <span className="field-label">Reason to send with items missing</span>
        <textarea aria-describedby={`reason-hint-${dealId}`} className="field" maxLength={OVERRIDE_REASON_LENGTH.max} name="overrideReason" rows={3} />
        <span className="mt-1 block text-xs text-titanium" id={`reason-hint-${dealId}`}>
          {missingCount
            ? `${missingCount} required item${missingCount === 1 ? " is" : "s are"} missing for ${TARGET_STAGE_LABELS[stage].toLowerCase()}. A send needs a reason of at least ${OVERRIDE_REASON_LENGTH.min} characters; the approving broker sees it with the missing items.`
            : `Also needed to send to a lender the matcher did not rank. At least ${OVERRIDE_REASON_LENGTH.min} characters.`}
        </span>
      </label>
      <div className="sm:col-span-2">
        <Check label="I re-checked a stale lender's appetite" name="allowStale" />
      </div>
      <div className="sm:col-span-2">
        <Submit>Request broker approval</Submit>
        <p className="mt-2 text-xs text-titanium">Nothing is sent, and no share link exists, until a broker approves. With email to lenders off, you get the approved text and the link to send yourself.</p>
      </div>
    </div>
  );
}
