import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/dal";
import { loadPipeline } from "./data";
import { formatUsd, isOpenDeal, summarizeStages } from "./model";
import { PipelineTable } from "./PipelineTable";

export const metadata: Metadata = { title: "Pipeline" };

export default function PipelinePage() {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">Deal desk</p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-ink">Pipeline</h1>
      </div>
      <Suspense fallback={<div className="bento h-96 animate-pulse" aria-label="Loading pipeline" />}>
        <Pipeline />
      </Suspense>
    </>
  );
}

async function Pipeline() {
  const ctx = await requireStaff("/pipeline");
  const rows = await loadPipeline(ctx);
  const stages = summarizeStages(rows);
  const active = rows.filter(isOpenDeal);
  const volume = active.reduce((s, r) => s + (r.loanAmountUsd ?? 0), 0);
  return (
    <>
      <section aria-label="Pipeline summary" className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="bento p-5">
          <p className="text-[13px] text-titanium">Active deals</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums">{active.length}</p>
        </div>
        <div className="bento p-5">
          <p className="text-[13px] text-titanium">Requested loan volume</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums">{formatUsd(volume)}</p>
        </div>
        <div className="bento p-5">
          <p className="text-[13px] text-titanium">Approvals waiting</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums">{rows.reduce((s, r) => s + r.pendingApprovals, 0)}</p>
        </div>
      </section>
      {stages.length > 0 ? (
        <ul aria-label="Active deals by stage" className="mb-6 flex flex-wrap gap-2">
          {stages.map((s) => (
            <li key={s.stage} className="rounded-full border border-hairline bg-white px-3.5 py-1.5 text-[13px]">
              <span className="font-medium text-ink">{s.label}</span> <span className="text-titanium">· {s.count} · {formatUsd(s.amountUsd)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">No deals yet. Deals appear here once an advisor opens a deal from a lead.</div>
      ) : (
        <PipelineTable rows={rows} />
      )}
    </>
  );
}
