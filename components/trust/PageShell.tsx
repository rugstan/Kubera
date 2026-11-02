import { Children, isValidElement, type ReactNode } from "react";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";

const CONTAINER = "mx-auto max-w-[1280px] px-5 md:px-8";

/**
 * Page frame shared by the trust pages: breadcrumb, eyebrow, H1 and intro on
 * white, then full-width sections that alternate canvas and white (the
 * `page-bands` rules in globals.css). Anything that is not a `Section` or a
 * JSON-LD block, such as a note or the license footnote, sits in its own
 * contained row.
 */
export function PageShell({
  eyebrow,
  title,
  intro,
  breadcrumb,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  breadcrumb?: { href: string; label: string }[];
  children: ReactNode;
  wide?: boolean;
}) {
  const rows = Children.toArray(children).map((child) => {
    if (isValidElement(child) && (child.type === Section || child.type === JsonLd)) return child;
    return (
      <div key={isValidElement(child) ? (child.key ?? undefined) : undefined} className={`${CONTAINER} py-6`}>
        {child}
      </div>
    );
  });
  return (
    <div className="overflow-x-clip">
      <div className={`${CONTAINER} pb-14 pt-16 md:pb-20 md:pt-24`}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-titanium">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li>
                <Link href="/" className="hover:text-ink hover:underline">Home</Link>
              </li>
              {breadcrumb.map((b) => (
                <li key={b.href} className="flex items-center gap-2">
                  <span aria-hidden>/</span>
                  <Link href={b.href} className="hover:text-ink hover:underline">{b.label}</Link>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <header className={wide ? "max-w-4xl" : "max-w-3xl"}>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] md:text-6xl">{title}</h1>
          {intro && <div className="mt-5 text-lg leading-relaxed text-titanium md:text-xl">{intro}</div>}
        </header>
      </div>
      <div className="page-bands pb-8 md:pb-12">{rows}</div>
    </div>
  );
}

export function Section({ id, title, lead, children }: { id?: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-24 py-14 md:py-20">
      <div className={CONTAINER}>
        <h2 id={id ? `${id}-title` : undefined} className="text-3xl font-semibold md:text-4xl">{title}</h2>
        {lead && <div className="mt-3 max-w-3xl text-[17px] leading-relaxed text-titanium">{lead}</div>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export function LicenseFootnote({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-[12px] leading-relaxed text-titanium">{children}</p>;
}
