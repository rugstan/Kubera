import type { ReactNode } from "react";
import { PageContainer } from "./PageContainer";

/**
 * Body of the branded 404 and error pages: eyebrow, the page's single H1, a
 * short explanation and a row of ways back. Renders no landmark of its own so
 * it can sit inside whichever <main id="main-content"> the caller provides.
 */
export function StatusPanel({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <PageContainer className="py-20 md:py-32">
      <div className="max-w-2xl">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.08] md:text-6xl">{title}</h1>
        <div className="mt-5 text-lg leading-relaxed text-titanium md:text-xl">{children}</div>
        <div className="mt-10 flex flex-wrap gap-3">{actions}</div>
      </div>
    </PageContainer>
  );
}
