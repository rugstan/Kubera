import Link from "next/link";
import { CSLB_STATUSES, type CslbVerification } from "@/lib/checklists/cslb";
import { isStale, STAFF_MOVES } from "@/lib/checklists/engine";
import { CATEGORY_LABEL, CHECKLIST_CATEGORIES, ITEM_STATUS_LABEL, PROGRAM_LABEL, type ChecklistItemFile, type DealChecklist, type DealChecklistItem, type ItemStatus } from "@/lib/checklists/types";
import type { Readiness } from "@/lib/checklists/engine";
import { moveItemAction, recordCslbAction } from "../actions";
import { Badge, Card, date } from "./ui";

const FILE_STATUS_LABEL: Record<ChecklistItemFile["status"], string> = {
  pending_upload: "upload not finished",
  scanning: "scanning for viruses (not yet received)",
  uploaded: "received",
  rejected: "rejected",
};

const TONE: Record<ItemStatus, "good" | "warn" | "bad" | "muted"> = {
  requested: "muted",
  submitted: "warn",
  under_review: "warn",
  accepted: "good",
  rejected: "bad",
  waived: "good",
  not_applicable: "muted",
};


const RESPONSIBLE: Record<DealChecklistItem["responsible"], string> = { borrower: "Borrower", corin: "Corin", lender: "Lender of record", vendor: "Vendor", title_escrow: "Title / escrow" };

function ItemRow({ item, files, dealId, now }: { item: DealChecklistItem; files: ChecklistItemFile[]; dealId: string; now: Date }) {
  const stale = isStale(item, now);
  const v = item.verification as CslbVerification | null;
  return (
    <li id={`item-${item.id}`} className="scroll-mt-6 border-t border-black/10 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[15px] font-semibold">
            {item.title}
            {item.required ? null : <span className="ml-2 text-[13px] font-normal text-ink/80">(optional)</span>}
          </h4>
          <p className="mt-0.5 text-[13px] text-ink/80">
            {RESPONSIBLE[item.responsible]} · {item.stage.replace("_", "-")}
            {item.recencyDays ? ` · must be dated within ${item.recencyDays} days of closing` : ""}
            {item.documentDate ? ` · dated ${item.documentDate}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={TONE[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          {stale ? <Badge tone="bad">Out of date</Badge> : null}
        </div>
      </div>
      {item.reviewNote ? <p className="mt-2 text-[13px]">Note: {item.reviewNote}</p> : null}
      {item.waivedReason ? <p className="mt-2 text-[13px]">Reason: {item.waivedReason}</p> : null}
      {files.length ? (
        <ul className="mt-2 text-[13px]" aria-label={`Files for ${item.title}`}>
          {files.map((f) => (
            <li key={f.id}>
              {f.status === "uploaded" && f.documentId ? (
                // Opens through the vault viewer: access check, audit row, short-lived signed link.
                <Link href={`/documents/${f.documentId}`} className="font-medium text-accent underline underline-offset-2">
                  {f.fileName}
                </Link>
              ) : (
                f.fileName
              )}{" "}
              — {FILE_STATUS_LABEL[f.status]} {f.uploadedAt ? `on ${date(f.uploadedAt)}` : ""} by {f.uploadedBy}
              {f.rejectReason ? ` (${f.rejectReason})` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {item.lookup === "cslb_license" ? (
        <details className="mt-3 rounded-xl border border-black/10 p-3">
          <summary className="cursor-pointer text-[14px] font-medium">
            CSLB license check {v ? (v.satisfied ? "— verified" : `— ${v.problems.length} problem(s)`) : "— not checked"}
          </summary>
          {v ? (
            <p className="mt-2 text-[13px]">
              #{v.licenseNumber} {v.businessName}, {v.status}, classes {v.classifications.join(", ") || "none"}, expires {v.expiresOn ?? "n/a"}; checked {date(v.checkedAt)} by {v.checkedBy}.
              {v.problems.length ? ` Problems: ${v.problems.join(" ")}` : ""}
            </p>
          ) : null}
          <form action={recordCslbAction} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="version" value={item.version} />
            <div>
              <label className="field-label" htmlFor={`lic-${item.id}`}>License #</label>
              <input id={`lic-${item.id}`} name="licenseNumber" required inputMode="numeric" className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor={`biz-${item.id}`}>Business name</label>
              <input id={`biz-${item.id}`} name="businessName" required className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor={`st-${item.id}`}>Status on CSLB</label>
              <select id={`st-${item.id}`} name="status" className="field">
                {CSLB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor={`cls-${item.id}`}>Classifications</label>
              <input id={`cls-${item.id}`} name="classifications" placeholder="B, C-10" className="field" />
            </div>
            <div>
              <label className="field-label" htmlFor={`exp-${item.id}`}>Expires</label>
              <input id={`exp-${item.id}`} name="expiresOn" type="date" className="field" />
            </div>
            <fieldset className="flex flex-col justify-end gap-1 text-[14px]">
              <legend className="sr-only">On file with CSLB</legend>
              <label className="flex items-center gap-2"><input type="checkbox" name="bondOnFile" /> Bond on file</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="workersCompOnFile" /> Workers&apos; comp on file</label>
            </fieldset>
            <button type="submit" className="pill pill-glass !py-2 !text-[15px] sm:col-span-3 sm:justify-self-start">Record license check</button>
          </form>
        </details>
      ) : null}

      <form action={moveItemAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
        <input type="hidden" name="dealId" value={dealId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="version" value={item.version} />
        <div>
          <label className="field-label" htmlFor={`to-${item.id}`}>Change to</label>
          <select id={`to-${item.id}`} name="to" className="field">
            {STAFF_MOVES[item.status].map((s) => (
              <option key={s} value={s}>
                {ITEM_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`note-${item.id}`}>Note or reason</label>
          <input id={`note-${item.id}`} name="note" maxLength={2000} className="field" />
        </div>
        <div>
          <label className="field-label" htmlFor={`dd-${item.id}`}>Document date</label>
          <input id={`dd-${item.id}`} name="documentDate" type="date" defaultValue={item.documentDate ?? undefined} className="field" />
        </div>
        <button type="submit" className="pill pill-glass !py-2 !text-[15px]">Update</button>
      </form>
    </li>
  );
}

export function ItemsSection({ checklist, readiness, items, files, now }: { checklist: DealChecklist; readiness: Readiness; items: DealChecklistItem[]; files: ChecklistItemFile[]; now: Date }) {
  const filesByItem = new Map<string, ChecklistItemFile[]>();
  for (const f of files) filesByItem.set(f.itemId, [...(filesByItem.get(f.itemId) ?? []), f]);
  return (
    <Card
      id={`checklist-${checklist.program.toLowerCase()}`}
      title={checklist.title}
      actions={<Badge tone={readiness.ready ? "good" : "warn"}>{readiness.requiredSatisfied} of {readiness.requiredTotal} required items done</Badge>}
    >
      <p className="mb-2 text-[13px] text-ink/80">
        {PROGRAM_LABEL[checklist.program]} · template {checklist.templateVersion} · started {date(checklist.createdAt)} by {checklist.createdBy}
      </p>
      {CHECKLIST_CATEGORIES.map((cat) => {
        const list = items.filter((i) => i.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat} className="mt-5">
            <h3 className="eyebrow">{CATEGORY_LABEL[cat]}</h3>
            <ul>
              {list.map((i) => (
                <ItemRow key={i.id} item={i} files={filesByItem.get(i.id) ?? []} dealId={checklist.dealId} now={now} />
              ))}
            </ul>
          </div>
        );
      })}
    </Card>
  );
}
