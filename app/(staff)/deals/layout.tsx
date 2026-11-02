import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { default: "Deal desk", template: "%s · Deal desk" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/deals", label: "Deals" },
  { href: "/deals/lenders", label: "Lender panel" },
  { href: "/deals/dre", label: "DRE reporting" },
];

// Renders inside the (staff) layout, which owns the page's <main> landmark and
// the authenticated shell.
export default function DealDeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="glass rounded-2xl border border-black/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link className="font-semibold tracking-tight text-ink" href="/deals">
            Corin deal desk
          </Link>
          <nav aria-label="Deal desk">
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
          <p className="ml-auto text-xs text-titanium">Broker records only. Corin never holds or moves loan funds.</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</div>
    </div>
  );
}
