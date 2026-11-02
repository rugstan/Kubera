import Link from "next/link";
import { LEGAL_PAGES } from "@/components/legal/legal";
import { contactDetails } from "@/content/contact";
import { CALIFORNIA_BASE, MARKETS, marketPath } from "@/content/markets/california";
import { disclosures, licenseLine, site } from "@/lib/site";
import { Logo } from "./Logo";
import { ACCOUNT_LINKS, ALL_FINANCING, FINANCING_FAMILIES, HEADER_CTA, type NavLink } from "./nav";

// The header carries only what a customer needs to start. Everything else lives
// here: the tools and resources, Glossary, Partners, and the sign-in links.
const COLUMNS: { title: string; links: readonly NavLink[] }[] = [
  {
    title: "Financing",
    links: [
      ALL_FINANCING,
      ...FINANCING_FAMILIES,
      { href: "/financing/hud-232", label: "HUD 232" },
      { href: "/financing/sba-504-hotel", label: "SBA 504 hotel loans" },
    ],
  },
  {
    title: "Tools and resources",
    links: [
      { href: "/#sizer", label: "60-second loan sizer" },
      { href: "/express", label: "Deal qualifier" },
      { href: "/rates", label: "Capital markets rates" },
      { href: "/calculators", label: "Loan calculators" },
      { href: "/insights", label: "Insights" },
      { href: "/glossary", label: "Glossary" },
      { href: "/newsletter", label: "Newsletter" },
    ],
  },
  {
    title: "Markets",
    links: [
      { href: CALIFORNIA_BASE, label: "California" },
      ...MARKETS.map((m) => ({ href: marketPath(m.slug), label: m.name })),
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Kubera" },
      { href: "/team", label: "Our advisors" },
      { href: "/track-record", label: "Track record" },
      { href: "/structures", label: "Representative structures" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Partners",
    links: [
      { href: "/partners", label: "Partner with Kubera" },
      { href: "/partners#lender", label: "Wholesale lenders" },
      { href: "/partners#referral", label: "Referral brokers" },
      { href: "/partners#operator", label: "Operators" },
      { href: "/partners#vendor", label: "Third-party vendors" },
    ],
  },
  { title: "Legal", links: LEGAL_PAGES },
];

export function Footer() {
  const { telHref, phone } = contactDetails();
  return (
    <footer className="border-t border-hairline bg-canvas text-[12px]">
      <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(6,1fr)] lg:gap-8">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs leading-relaxed text-graphite">
              Commercial real estate loan brokerage for senior living, hotels, multifamily, construction and hard money. We arrange loans as a licensed California real estate broker; we are not the lender.
            </p>
            <div className="mt-5">
              <Link href={HEADER_CTA.href} className="pill pill-primary pill-sm">
                {HEADER_CTA.label}
              </Link>
            </div>
            <a href={`mailto:${site.email}`} className="mt-5 inline-block text-accent hover:underline">
              {site.email}
            </a>
            {telHref ? (
              <a href={`tel:${telHref}`} className="mt-1 block text-graphite hover:underline">
                {phone}
              </a>
            ) : null}
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-[12px] font-semibold text-ink">{c.title}</h2>
              <ul className="mt-4 space-y-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-graphite hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 space-y-3 border-t border-hairline pt-8 leading-relaxed text-titanium">
          <p className="font-medium text-graphite">{licenseLine()}</p>
          <p>{disclosures.indicative}</p>
          <p>
            © <Year /> {site.legalName} HUD, FHA, and SBA program names are used descriptively; Kubera Commercial is not affiliated with or endorsed by any government agency. Equal Housing Opportunity.
          </p>
        </div>
        {/*
          The owner's way into the back office, and the borrower's way into the portal.
          Plain anchors, not Link, so nothing prefetches the auth pages; both paths are
          robots-disallowed and noindex.
        */}
        <nav aria-label="Account" className="mt-6">
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-titanium">
            {ACCOUNT_LINKS.map((l, i) => (
              <li key={l.href} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden>·</span> : null}
                <a href={l.href} rel="nofollow" className="inline-flex min-h-6 items-center hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

async function Year() {
  "use cache";
  return new Date().getFullYear();
}
