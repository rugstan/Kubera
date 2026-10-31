import Link from "next/link";
import { disclosures, licenseLine, site } from "@/lib/site";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "Financing",
    links: [
      { href: "/#senior-living", label: "HUD 232 & Senior Living" },
      { href: "/#hospitality", label: "SBA 504 Hotel Stacks" },
      { href: "/#hospitality", label: "CMBS & PIP Bridge" },
      { href: "/#multifamily", label: "Multifamily & Construction" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/#sizer", label: "60-Second Loan Sizer" },
      { href: "/express", label: "Smart Deal Qualifier" },
      { href: "/#rates", label: "Capital Markets Rates" },
    ],
  },
  {
    title: "Partners",
    links: [
      { href: "/partners#lender", label: "Wholesale Lenders" },
      { href: "/partners#referral", label: "Referral Brokers" },
      { href: "/partners#operator", label: "Operators" },
      { href: "/partners#vendor", label: "Third-Party Vendors" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-black/[0.06] bg-canvas">
      <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-titanium">
              AI-first commercial debt advisory for senior living, hospitality, and multifamily real estate.
            </p>
            <a href={`mailto:${site.email}`} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              {site.email}
            </a>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h3 className="text-xs font-semibold tracking-normal text-ink">{c.title}</h3>
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
        <div className="mt-14 space-y-3 border-t border-black/[0.06] pt-8 text-[11px] leading-relaxed text-titanium">
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
