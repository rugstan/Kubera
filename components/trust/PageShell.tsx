import type { ReactNode } from "react";
import Link from "next/link";

/** Page frame shared by the trust pages: breadcrumb, eyebrow, H1 and intro. */
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
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8 md:py-24">
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
        <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">{title}</h1>
        {intro && <div className="mt-5 text-lg leading-relaxed text-titanium md:text-xl">{intro}</div>}
      </header>
      <div className="mt-14 space-y-14 md:mt-20 md:space-y-20">{children}</div>
    </div>
  );
}

export function Section({ id, title, lead, children }: { id?: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-24">
      <h2 id={id ? `${id}-title` : undefined} className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      {lead && <div className="mt-3 max-w-3xl text-[17px] leading-relaxed text-titanium">{lead}</div>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function LicenseFootnote({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-[12px] leading-relaxed text-titanium">{children}</p>;
}
