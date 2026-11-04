import Link from "next/link";
import { LEGAL_PAGES } from "@/components/legal/legal";
import { contactDetails } from "@/content/contact";
import { CALIFORNIA_BASE, MARKETS, marketPath } from "@/content/markets/california";
import { TEAM, teamCards } from "@/content/team";
import { publishableRecords } from "@/content/track-record";
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
      { href: "/about", label: "About Corin" },
      { href: "/team", label: "Our advisors" },
      { href: "/track-record", label: "Track record" },
      { href: "/structures", label: "Representative structures" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Partners",
    links: [
      { href: "/partners", label: "Partner with Corin" },
      { href: "/partners#lender", label: "Wholesale lenders" },
      { href: "/partners#referral", label: "Referral brokers" },
      { href: "/partners#operator", label: "Operators" },
      { href: "/partners#vendor", label: "Third-party vendors" },
    ],
  },
  { title: "Legal", links: LEGAL_PAGES },
];

/**
 * Proof pages are linked only once they have something to show: /team when at
 * least one advisor profile is complete enough for production (a real bio and a
 * DRE number), /track-record after the first verified closing. An empty proof
 * page linked from every page reads as a weakness on a site built to convert.
 */
const SHOW_WHEN: Partial<Record<string, () => boolean>> = {
  "/team": () => teamCards(TEAM, { production: true }).length > 0,
  "/track-record": () => publishableRecords().length > 0,
};

function footerColumns() {
  return COLUMNS.map((c) => ({ ...c, links: c.links.filter((l) => SHOW_WHEN[l.href]?.() ?? true) }));
}

const LINK = "text-graphite hover:underline max-md:flex max-md:min-h-9 max-md:items-center";

export function Footer() {
  const { telHref, phone } = contactDetails();
  const columns = footerColumns();
  return (
    <footer className="border-t border-hairline bg-canvas text-[12px]">
      <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8">
        <div className="grid gap-12 md:grid-cols-3 lg:grid-cols-[1.4fr_repeat(6,1fr)] lg:gap-8">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs leading-relaxed text-graphite">
              Commercial real estate loan brokerage for senior living, hotels, multifamily, construction and hard money. We arrange loans as a licensed California real estate broker; we are not the lender.
            </p>
            <div className="mt-5">
              <Link href={HEADER_CTA.href} className="pill pill-primary pill-sm max-md:min-h-9">
                {HEADER_CTA.label}
              </Link>
            </div>
            <a href={`mailto:${site.email}`} className="mt-5 inline-flex items-center text-accent hover:underline max-md:min-h-9">
              {site.email}
            </a>
            {telHref ? (
              <a href={`tel:${telHref}`} className="mt-1 flex w-fit items-center text-graphite hover:underline max-md:min-h-9">
                {phone}
              </a>
            ) : null}
          </div>
          {columns.map((c) => (
            <div key={c.title} className="max-md:hidden">
              <h2 className="text-[12px] font-semibold text-ink">{c.title}</h2>
              <ul className="mt-4 space-y-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className={LINK}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {/*
          Phones: each column folds into a 44px disclosure row, as on apple.com, so the
          footer is a short list instead of seven stacked columns. Native <details>
          works without JavaScript. The desktop columns above are display:none here,
          so assistive technology meets each link once.
        */}
        <div className="mt-10 divide-y divide-hairline border-y border-hairline md:hidden">
          {columns.map((c) => (
            <details key={c.title} className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {c.title}
                <span aria-hidden className="text-[17px] font-normal text-titanium transition-transform group-open:rotate-45">+</span>
              </summary>
              {/* Each link is a 36px row, so the footer stays easy to tap. */}
              <ul className="pb-3">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className={`${LINK} text-[14px]`}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        <div className="mt-14 space-y-3 border-t border-hairline pt-8 leading-relaxed text-titanium">
          <p className="font-medium text-graphite">{licenseLine()}</p>
          <p>{disclosures.indicative}</p>
          <p>
            © <Year /> {site.legalName} HUD, FHA, and SBA program names are used descriptively; Corin Commercial is not affiliated with or endorsed by any government agency. Equal Housing Opportunity.
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
                <a href={l.href} rel="nofollow" className="inline-flex min-h-6 items-center hover:underline max-md:min-h-9">
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
