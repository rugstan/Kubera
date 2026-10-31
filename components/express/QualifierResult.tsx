"use client";

import { motion } from "motion/react";
import { usd } from "@/lib/sizing/programs";
import { disclosures } from "@/lib/site";
import { DocumentUpload } from "./DocumentUpload";

const FLAG_COPY: Record<string, string> = {
  OPTIMAL_FOR_HUD_232: "Your request looks like a match for HUD 232's long-term, non-recourse financing, subject to lender underwriting.",
  LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS: "At this size, SBA 504 often costs less all-in than HUD — no annual HUD audit and lower closing costs.",
  USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY: "A combined SBA 7(a) + 504 stack may finance this project with 15–20% down, subject to SBA eligibility and lender approval.",
  NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST: "A bridge loan first, then permanent debt once operations stabilize, can often increase proceeds.",
  OPTIMAL_AS_STRUCTURED: "This structure looks workable as submitted. An advisor will test it with lenders.",
};

export type QualifierResponse = {
  leadId: string | null;
  uploadToken: string | null;
  result: {
    program: string | null;
    secondary: string | null;
    flag: string;
    indicativeLoan: number;
    indicativeRatePct: number | null;
    term: string | null;
    recourse: string | null;
    closeTimeline: string | null;
    callScheduled: boolean;
    qualified: boolean;
  };
};

export function QualifierResult({ r, firstName, headingRef }: { r: QualifierResponse; firstName: string; headingRef: (el: HTMLHeadingElement | null) => void }) {
  const x = r.result;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="text-center">
        <p className="eyebrow">{x.qualified ? "Indicative match" : "Request received"}</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-3 text-4xl font-semibold tracking-tight outline-none md:text-5xl">
          {x.qualified ? `Thanks, ${firstName}. Here's your starting point.` : `Thanks, ${firstName}. An advisor will review this personally.`}
        </h2>
      </div>
      {x.qualified && x.program && (
        <div className="bento p-6 md:p-8">
          <p className="text-sm text-titanium">Indicative program fit</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{x.program}</p>
          <p className="mt-3 text-[15px] text-ink/80">{FLAG_COPY[x.flag]}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Indicative loan", usd(x.indicativeLoan)],
              ["Indicative rate", x.indicativeRatePct ? `${x.indicativeRatePct.toFixed(2)}%` : "—"],
              ["Term", x.term ?? "—"],
              ["Typical timeline*", x.closeTimeline ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-titanium">{k}</dt>
                <dd className="text-[15px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {x.secondary && <p className="mt-5 text-[13px] text-titanium">Alternative we&apos;ll also price: {x.secondary}</p>}
          <p className="mt-4 text-[12px] leading-relaxed text-titanium">* {disclosures.timeline}</p>
        </div>
      )}
      <div className="bento p-6">
        <p className="font-medium">
          {x.callScheduled ? "We've flagged your request for priority review by a senior advisor." : "A licensed advisor will review your request and follow up, usually within one business day."}
        </p>
        <p className="mt-1 text-sm text-titanium">Speed things up by sharing your T-12, rent roll or census, and STR report. Files go to an encrypted, private vault.</p>
        {r.leadId && r.uploadToken ? <DocumentUpload leadId={r.leadId} token={r.uploadToken} /> : null}
      </div>
      <p className="text-[12px] leading-relaxed text-titanium">
        {disclosures.indicative} An indicative match is not a loan approval or commitment; only a lender can approve a loan, in writing.
      </p>
    </motion.div>
  );
}
