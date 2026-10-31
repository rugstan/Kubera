import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { default: "Prospects", template: "%s · Prospects" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/prospects", label: "Prospects" },
  { href: "/prospects/intel", label: "Market intel" },
  { href: "/prospects/suppressions", label: "Do not contact" },
];

// Renders inside the (staff) layout, which owns <main> and the authenticated shell.
export default function ProspectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="glass rounded-2xl border border-black/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link className="font-semibold tracking-tight text-ink" href="/prospects">
            Market intel &amp; prospecting
          </Link>
          <nav aria-label="Prospecting">
            <ul className="flex flex-wrap gap-4 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link className="inline-flex min-h-11 items-center text-titanium hover:text-ink" href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="ml-auto text-xs text-titanium">Built from public records and public signals. Nothing is sent without broker approval.</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</div>
    </div>
  );
}
