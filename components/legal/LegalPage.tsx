import { DraftNotice } from "./DraftNotice";
import { LEGAL_EFFECTIVE_DATE } from "./legal";

// Shell for the legal pages: title, effective date, draft banner, and prose
// styles applied to the plain HTML children.
const PROSE = [
  "text-[16px] leading-relaxed text-ink/85",
  "[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-ink",
  "[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink",
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
  "[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
  "[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[14px]",
  "[&_th]:border-b [&_th]:border-black/10 [&_th]:py-2 [&_th]:pr-4 [&_th]:align-top [&_th]:font-semibold [&_th]:text-ink",
  "[&_td]:border-b [&_td]:border-black/[0.06] [&_td]:py-3 [&_td]:pr-4 [&_td]:align-top",
].join(" ");

export function LegalPage({
  title,
  intro,
  children,
  effectiveDate = LEGAL_EFFECTIVE_DATE,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  effectiveDate?: string;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
      <DraftNotice />
      <header className="mt-8">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{title}</h1>
        <p className="mt-3 text-[14px] text-ink/70">Effective {effectiveDate}</p>
        {intro && <div className="mt-6 text-lg leading-relaxed text-ink/85">{intro}</div>}
      </header>
      <div className={`mt-4 ${PROSE}`}>{children}</div>
    </article>
  );
}

/** Wide tables scroll inside their own box on small screens instead of the page. */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // Focusable so keyboard users can scroll the table horizontally.
    <div role="region" aria-label={label} tabIndex={0} className="-mx-1 overflow-x-auto px-1">
      {children}
    </div>
  );
}
