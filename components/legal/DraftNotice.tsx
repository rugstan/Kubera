import { legalApproved } from "./legal";

// Visible banner on every drafted legal page until counsel signs off and
// NEXT_PUBLIC_LEGAL_APPROVED is set to "true".
export function DraftNotice({ approved = legalApproved() }: { approved?: boolean }) {
  if (approved) return null;
  return (
    <div role="note" aria-label="Draft notice" data-draft-notice className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-[14px] leading-relaxed text-amber-950">
      <p className="font-semibold">DRAFT — pending counsel review</p>
      <p className="mt-1">This page is a working draft. Our attorneys have not reviewed it yet, and it may change before it is final.</p>
    </div>
  );
}
