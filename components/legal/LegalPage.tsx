import { Children, isValidElement, type ReactNode } from "react";
import { MAIN_COLUMN, PageContainer, SIDEBAR_GRID, SIDE_COLUMN } from "@/components/site/PageContainer";
import { DraftNotice } from "./DraftNotice";
import { LEGAL_EFFECTIVE_DATE } from "./legal";

// Shell for the legal pages: title, effective date, draft banner, and prose
// styles applied to the plain HTML children. In the site container, the text
// sits in the main column (running text about 70 characters wide, tables the
// full column) beside a sticky table of contents from lg.
const PROSE = [
  "text-[16px] leading-relaxed text-ink/85 [&>:first-child]:mt-0",
  "[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-ink",
  "[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink",
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
  "[&_p]:max-w-[70ch] [&_ul]:max-w-[70ch] [&_ol]:max-w-[70ch]",
  "[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
  "[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[14px]",
  "[&_th]:border-b [&_th]:border-black/10 [&_th]:py-2 [&_th]:pr-4 [&_th]:align-top [&_th]:font-semibold [&_th]:text-ink",
  "[&_td]:border-b [&_td]:border-black/[0.06] [&_td]:py-3 [&_td]:pr-4 [&_td]:align-top",
].join(" ");

type TocEntry = { id: string; label: string };

/** The page's top-level headings: every `<h2 id>` child with plain-text content. */
function tableOfContents(children: ReactNode): TocEntry[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ id?: unknown; children?: unknown }>(child) || child.type !== "h2") return [];
    const { id, children: label } = child.props;
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
}

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
  const toc = tableOfContents(children);
  return (
    <PageContainer as="article" className="py-16 md:py-24">
      <DraftNotice />
      <header className="mt-8 max-w-3xl">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{title}</h1>
        <p className="mt-3 text-[14px] text-ink/70">Effective {effectiveDate}</p>
        {intro && <div className="mt-6 text-lg leading-relaxed text-ink/85">{intro}</div>}
      </header>
      <div className={`mt-12 ${SIDEBAR_GRID}`}>
        <div className={`${MAIN_COLUMN} ${PROSE}`}>{children}</div>
        {toc.length > 1 && (
          // Phones read the page straight through; the contents list shows beside it from lg.
          <div className={`${SIDE_COLUMN} hidden lg:block`}>
            <TableOfContents entries={toc} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}

/**
 * "On this page" links, sticky under the header from lg (so it must be a
 * direct child of the tall side column). Scrolls on its own if a short window
 * cannot hold it.
 */
export function TableOfContents({ entries }: { entries: TocEntry[] }) {
  return (
    <nav aria-labelledby="toc-heading" className="bento p-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
      <p id="toc-heading" className="text-[13px] font-semibold text-graphite">
        On this page
      </p>
      <ol className="mt-3 space-y-1 text-[14px] leading-snug">
        {entries.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="inline-flex min-h-8 items-center py-1 text-ink/80 underline-offset-2 hover:text-ink hover:underline">
              {e.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
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
