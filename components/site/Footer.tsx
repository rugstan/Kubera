import Link from "next/link";
import { LEGAL_PAGES } from "@/components/legal/legal";
import { CALIFORNIA_BASE, MARKETS, marketPath } from "@/content/markets/california";
import { disclosures, licenseLine, site } from "@/lib/site";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "Financing",
    links: [
      { href: "/financing", label: "All financing programs" },
      { href: "/financing/senior-living", label: "Senior living" },
      { href: "/financing/hud-232", label: "HUD 232" },
      { href: "/financing/hotels", label: "Hotels" },
      { href: "/financing/sba-504-hotel", label: "SBA 504 hotel loans" },
      { href: "/financing/multifamily", label: "Multifamily" },
      { href: "/financing/construction", label: "Construction" },
      { href: "/financing/hard-money", label: "Hard money" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/#sizer", label: "60-second loan sizer" },
      { href: "/express", label: "Deal qualifier" },
      { href: "/rates", label: "Capital markets rates" },
      { href: "/calculators", label: "Loan calculators" },
      { href: "/glossary", label: "Glossary" },
      { href: "/insights", label: "Insights" },
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
    title: "Partners",
    links: [
      { href: "/partners#lender", label: "Wholesale lenders" },
      { href: "/partners#referral", label: "Referral brokers" },
      { href: "/partners#operator", label: "Operators" },
      { href: "/partners#vendor", label: "Third-party vendors" },
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
  { title: "Legal", links: LEGAL_PAGES },
];

export function Footer() {
  return (
    <footer className="border-t border-black/[0.06] bg-canvas">
      <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:gap-8 lg:grid-cols-[1.4fr_repeat(6,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-titanium">
              Advisor-led, AI-assisted debt advisory for senior living, hospitality, and multifamily real estate. We arrange loans as a licensed broker; we are not the lender.
            </p>
            <a href={`mailto:${site.email}`} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              {site.email}
            </a>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-xs font-semibold tracking-normal text-ink">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm text-titanium">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="transition-colors hover:text-ink">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 space-y-3 border-t border-black/[0.06] pt-8 text-[12px] leading-relaxed text-titanium">
          <p className="font-medium text-ink/70">{licenseLine()}</p>
          <p>{disclosures.indicative}</p>
          <p>{disclosures.ai}</p>
          <p>
            © <Year /> {site.legalName} HUD, FHA, and SBA program names are used descriptively; Kubera Commercial is not affiliated with or endorsed by any government agency. Equal Housing Opportunity.
          </p>
        </div>
      </div>
    </footer>
  );
}

async function Year() {
  "use cache";
  return new Date().getFullYear();
}
