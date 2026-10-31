import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { default: "Lenders", template: "%s · Lenders" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/lenders", label: "Credit boxes" },
  { href: "/lenders/boxes/new", label: "Add a credit box" },
  { href: "/deals/lenders", label: "Lender panel" },
];

// Renders inside the (staff) layout, which owns <main> and the authenticated shell.
export default function LendersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="glass rounded-2xl border border-black/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link className="font-semibold tracking-tight text-ink" href="/lenders">
            Lender matching
          </Link>
          <nav aria-label="Lenders">
            <ul className="flex flex-wrap gap-4 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link className="text-titanium hover:text-ink" href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="ml-auto text-xs text-titanium">Kubera brokers; lenders underwrite, decide and fund. Nothing is sent without broker approval.</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</div>
    </div>
  );
}
