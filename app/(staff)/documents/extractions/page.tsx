import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { listReviewQueue } from "@/lib/agents/documents/review";
import { documentReviewDeps } from "@/lib/agents/documents/server";
import { specFor } from "@/lib/agents/documents/specs";
import { RESTRICTED_FIELDS_UNAVAILABLE, type ExtractionRecord } from "@/lib/agents/documents/store";
import { REVIEW_THRESHOLD, type DocType } from "@/lib/agents/documents/types";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { ReviewForm, type ReviewField } from "./ReviewForms";

export const metadata: Metadata = { title: "Extraction review" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DOC_TYPE_LABELS: Record<DocType, string> = {
  T12: "T-12 operating statement",
  RENT_ROLL: "Rent roll",
  CENSUS: "Census",
  STR: "STR report",
  PFS: "Personal financial statement",
  CONSTRUCTION_BUDGET: "Construction budget",
  TERM_SHEET: "Term sheet",
};

const WARNING_LABELS: Record<string, string> = {
  doc_type_inferred: "Document type was inferred, not declared",
  injection_suspected: "The document contained text addressed to an AI; it was removed before extraction, so check every figure",
  [RESTRICTED_FIELDS_UNAVAILABLE]: "Restricted fields cannot be decrypted on this deployment",
};
const warningLabel = (w: string) => WARNING_LABELS[w] ?? w.replace(/_/g, " ");

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function ExtractionReviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">
          <Link href="/documents" className="hover:underline">
            Documents
          </Link>
        </p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-ink">Extraction review</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">
          Figures read from borrower documents with low confidence, or that do not add up, wait here. Correct what is wrong, then approve: only approved or
          confident extractions feed the spreads and loan sizing.
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading the review queue" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function fieldsFor(rec: ExtractionRecord): ReviewField[] {
  if (!rec.doc_type) return [];
  const low = new Set(rec.low_confidence_fields);
  return specFor(rec.doc_type).scalars.map((f) => {
    const v = rec.fields.scalars[f.key];
    const value = v?.value;
    return {
      key: f.key,
      label: f.label,
      value: value === null || value === undefined ? "" : String(value),
      confidence: v && v.value !== null ? v.confidence : null,
      evidence: v?.evidence ?? null,
      source: v?.source ?? null,
      required: Boolean(f.required),
      low: low.has(f.key) || (v !== undefined && v.value !== null && v.confidence < REVIEW_THRESHOLD) || (Boolean(f.required) && (value === null || value === undefined)),
    };
  });
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await requireStaff("/documents/extractions");
  const allowed = can(ctx.principal, "review_extractions", californiaDate(new Date()));
  if (!allowed.ok) return <div className="bento p-8 text-titanium">{allowed.reason}</div>;
  const deps = await documentReviewDeps();
  if (!deps) return <div className="bento p-8 text-titanium">The extraction review queue is not configured on this deployment.</div>;
  const queue = await listReviewQueue(deps.store, 100);
  const approvedId = z.uuid().safeParse(sp.approved).data;
  const rejectedId = z.uuid().safeParse(sp.rejected).data;

  return (
    <>
      {approvedId ? (
        <p role="status" className="badge-emerald mb-5 rounded-xl px-4 py-3 text-[14px]">
          Extraction approved. The spreads for its deal are recalculated from it.
        </p>
      ) : null}
      {rejectedId ? (
        <p role="status" className="badge-emerald mb-5 rounded-xl px-4 py-3 text-[14px]">
          Extraction rejected. It will not feed the spreads.
        </p>
      ) : null}
      {queue.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">Nothing is waiting for review.</div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Extractions waiting for review">
          {queue.map((rec) => {
            const title = `${rec.doc_type ? DOC_TYPE_LABELS[rec.doc_type] : "Document"}${rec.attachment_name ? `: ${rec.attachment_name}` : ""}`;
            const unavailable = rec.warnings.includes(RESTRICTED_FIELDS_UNAVAILABLE);
            return (
              // min-w-0: a grid item otherwise grows to its content's min width, so the field
              // table would widen the page instead of scrolling inside its own wrapper.
              <li key={rec.id} className="min-w-0">
                <article className="bento p-6" aria-labelledby={`extraction-${rec.id}`}>
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="badge-gold rounded-full px-2.5 py-0.5 font-medium">Needs review</span>
                    {rec.doc_type === "PFS" ? <span className="rounded-full border border-black/10 bg-canvas px-2.5 py-0.5 text-ink">Restricted · encrypted at rest</span> : null}
                    <span className="text-titanium">
                      Overall confidence {rec.overall_confidence === null ? "—" : `${Math.round(rec.overall_confidence * 100)}%`} · read{" "}
                      <time dateTime={rec.created_at}>{dateFmt.format(new Date(rec.created_at))}</time> · {rec.engine}
                    </span>
                  </div>
                  <h2 id={`extraction-${rec.id}`} className="mt-2 text-[17px] font-semibold leading-snug text-ink">
                    {title}
                  </h2>
                  {rec.deal_id ? (
                    <p className="mt-1 text-[14px]">
                      <Link href={`/deals/${rec.deal_id}`} className="text-accent underline underline-offset-2">
                        Open deal
                      </Link>
                    </p>
                  ) : null}
                  {rec.warnings.length ? (
                    <ul className="mt-3 list-disc pl-5 text-[14px] text-amber-900" aria-label="Checks that failed">
                      {rec.warnings.map((w) => (
                        <li key={w}>{warningLabel(w)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {rec.fields.rows.length ? (
                    <p className="mt-2 text-[14px] text-titanium">
                      {rec.fields.rows.length} {rec.fields.rows.length === 1 ? "row" : "rows"} read; {rec.fields.rows.filter((r) => r.confidence < REVIEW_THRESHOLD).length} below the
                      confidence threshold.
                    </p>
                  ) : null}
                  {unavailable ? (
                    <p className="mt-3 text-[14px] text-red-800">This statement is encrypted and the key is not available here, so it cannot be reviewed.</p>
                  ) : (
                    <ReviewForm id={rec.id} title={title} fields={fieldsFor(rec)} />
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
