import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseId } from "@/components/trust/LicenseId";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { aboutPageSchema } from "@/components/trust/schemas";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine, site } from "@/lib/site";

const meta = TRUST_PAGES.about;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

const PRINCIPLES = [
  {
    title: "We arrange the loan for you",
    body: "Our job is to find the structure and the lender that fit your property and your plans, and to negotiate for you. We compare programs on all-in cost, not on rate alone.",
  },
  {
    title: "We are not the lender",
    body: disclosures.brokerNotLender,
  },
  {
    title: "Advisors lead every deal",
    body: "Our tools produce first-pass sizing and summaries so advisors spend their time on structure and lenders. A licensed advisor reviews every engagement, and nothing goes to a lender or to you without a broker's review.",
  },
  {
    title: "Honest about what we know",
    body: "Sizing results are estimates for discussion. They are not approvals or commitments. Only a lender can approve a loan, in writing.",
  },
] as const;

const STEPS = [
  { title: "Tell us about the property", body: "Use the 60-second qualifier or book a call. We ask for the property, the plan and the loan you have in mind." },
  { title: "We size and compare structures", body: "An advisor reviews the programs that may fit, such as HUD, SBA, CMBS, agency and bridge, and explains the trade-offs." },
  { title: "We take it to lenders", body: "With your go-ahead, we package the file and approach lenders that fit. Lenders underwrite and decide." },
  { title: "Disclosures and closing", body: "On loans secured by real property you receive a Mortgage Loan Disclosure Statement before you are obligated. The lender closes and funds the loan." },
] as const;

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="About Kubera Commercial"
      title="A licensed broker, not a lender."
      intro={
        <p>
          {site.legalName} is a California real estate corporation. We arrange commercial real estate loans for owners and buyers of senior living, hospitality and multifamily properties.
        </p>
      }
      breadcrumb={[{ href: meta.path, label: "About" }]}
    >
      <JsonLd
        data={[
          aboutPageSchema({ path: meta.path, name: "About Kubera Commercial", description: meta.description }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "About", path: meta.path },
          ]),
        ]}
      />

      <Section id="how-we-work" title="How we work">
        <ul className="grid gap-5 md:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="bento p-7">
              <h3 className="text-xl font-semibold">{p.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-titanium">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="broker-not-lender" title="What broker means for you" lead="The line between broker and lender decides who holds your money and who makes the credit decision.">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">What Kubera does</h3>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-titanium">
              <li>Finds, compares and negotiates with lenders on your behalf.</li>
              <li>Packages your file and coordinates third-party reports.</li>
              <li>Gives you the required disclosures, including the Mortgage Loan Disclosure Statement.</li>
            </ul>
          </div>
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">What Kubera does not do</h3>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-titanium">
              <li>Make credit decisions. The lender underwrites and funds as lender of record.</li>
              <li>Accept, hold, transfer or disburse borrower, investor or loan funds.</li>
              <li>Service loans, or take part in construction draws, draw inspections or lien waivers.</li>
            </ul>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-[14px] text-titanium">
          Details are on the{" "}
          <Link href="/licensing" className="font-medium text-accent underline underline-offset-2">licensing and disclosures page</Link>, including how we are paid.
        </p>
      </Section>

      <Section id="licenses" title="Licenses" lead="You can verify any California real estate license with the Department of Real Estate.">
        <div className="bento overflow-hidden">
          <dl className="divide-y divide-black/[0.06] text-[15px]">
            <Row label="Licensee">{site.legalName}, real estate corporation</Row>
            <Row label="Regulator">California Department of Real Estate (DRE)</Row>
            <Row label="Corporate broker license">
              <LicenseId id={site.dreCorporateLicense} />
            </Row>
            <Row label="Designated officer">
              {site.designatedOfficer}
              {site.dreOfficerLicense && (
                <>
                  , broker license <LicenseId id={site.dreOfficerLicense} />
                </>
              )}
            </Row>
            {site.nmls && <Row label="NMLS ID">#{site.nmls}</Row>}
            {site.licensedAddress && <Row label="Main office">{site.licensedAddress}</Row>}
          </dl>
        </div>
        <p className="mt-4 text-[14px] text-titanium">
          Advisors who work with you are listed with their license numbers on the{" "}
          <Link href="/team" className="font-medium text-accent underline underline-offset-2">advisors page</Link>.
        </p>
      </Section>

      <Section id="process" title="What working with us looks like" lead={disclosures.timeline}>
        <ol className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bento p-7">
              <p className="text-sm font-semibold text-titanium">Step {i + 1}</p>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-titanium">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="next" title="Talk to an advisor">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href="/contact" className="pill pill-primary">Contact an advisor</Link>
          <Link href="/express" className="pill pill-glass">Start the 60-second qualifier</Link>
          <Link href="/structures" className="pill pill-glass">See representative structures</Link>
        </div>
      </Section>

      <LicenseFootnote>{licenseLine()}</LicenseFootnote>
    </PageShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-6 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
      <dt className="font-medium text-ink">{label}</dt>
      <dd className="text-titanium">{children}</dd>
    </div>
  );
}
