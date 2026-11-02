import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { LicenseId } from "@/components/trust/LicenseId";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { teamPageSchemas } from "@/components/trust/schemas";
import { TEAM, teamCards, type TeamCard } from "@/content/team";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { deploymentEnv, licenseLine, site } from "@/lib/site";

const meta = TRUST_PAGES.team;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

export default function TeamPage() {
  // Production hides placeholder profiles and licensed advisors without a license number.
  const production = deploymentEnv() === "production";
  const cards = teamCards(TEAM, { production });
  const hasPlaceholders = cards.some((c) => c.placeholder || c.license.kind === "pending");

  return (
    <PageShell
      eyebrow="Our advisors"
      title="Licensed advisors lead every engagement."
      intro={<p>Every loan Corin arranges is led by a California-licensed real estate professional. Verify any license with the Department of Real Estate.</p>}
      breadcrumb={[{ href: meta.path, label: "Advisors" }]}
    >
      <JsonLd
        data={teamPageSchemas({ path: meta.path, name: "Corin Commercial advisors", description: meta.description }, cards.filter((c) => !c.placeholder))}
      />

      {!production && hasPlaceholders && (
        <p role="note" className="notice max-w-3xl rounded-2xl px-5 py-4 text-[14px]">
          Preview only: entries marked as placeholders are hidden on the production site until a bio and, for licensed advisors, a DRE license number are added in <code>content/team.ts</code> or the license variables.
        </p>
      )}

      {cards.length > 0 ? (
        <Section id="advisors" title="Advisors">
          <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <li key={c.member.slug}>
                <AdvisorCard card={c} />
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <Section id="advisors" title="Advisor profiles are coming soon">
          <div className="bento max-w-3xl p-7">
            <p className="text-[16px] leading-relaxed text-titanium">
              We are preparing individual advisor profiles. Until they are published, here is who is accountable for the firm&apos;s license. Write to us and we will tell you which licensed advisor will work with you.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/contact" className="pill pill-primary">Contact an advisor</Link>
              <Link href="/about#licenses" className="pill pill-glass">See our licenses</Link>
            </div>
          </div>
        </Section>
      )}

      <Section id="designated-officer" title="Designated officer">
        <div className="bento max-w-3xl p-7">
          <p className="text-xl font-semibold">{site.designatedOfficer}</p>
          <p className="mt-1 text-[15px] text-titanium">Designated broker officer of {site.legalName}</p>
          <dl className="mt-5 space-y-3 text-[15px]">
            {/* The build guard only requires the corporate license, so the officer row renders only when its number is set (as on /about). */}
            {site.dreOfficerLicense && (
              <div>
                <dt className="font-medium text-ink">Officer license</dt>
                <dd className="text-titanium">
                  <LicenseId id={site.dreOfficerLicense} />
                </dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-ink">Corporate license</dt>
              <dd className="text-titanium">
                <LicenseId id={site.dreCorporateLicense} />
              </dd>
            </div>
          </dl>
        </div>
      </Section>

      <LicenseFootnote>{licenseLine()}</LicenseFootnote>
    </PageShell>
  );
}

function AdvisorCard({ card }: { card: TeamCard }) {
  const { member, license, placeholder } = card;
  return (
    <article id={member.slug} className="bento flex h-full scroll-mt-24 flex-col p-7">
      {(placeholder || license.kind === "pending") && (
        <p className="mb-4 w-fit rounded-full badge-warning px-2.5 py-1 text-[12px] font-medium">Placeholder, not public</p>
      )}
      <h3 className="text-xl font-semibold">{member.name}</h3>
      <p className="text-[15px] font-medium text-graphite">{member.title}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-titanium">{member.bio}</p>
      {member.focus.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {member.focus.map((f) => (
            <li key={f} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-ink/70">{f}</li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-6 text-[14px] text-titanium">
        {license.kind === "verified" && (
          <p>
            California DRE license <LicenseId id={license.id} />
          </p>
        )}
        {license.kind === "pending" && <p>California DRE license number pending.</p>}
        {member.email && (
          <p className="mt-1">
            <a href={`mailto:${member.email}`} className="font-medium text-accent underline underline-offset-2">{member.email}</a>
          </p>
        )}
      </div>
    </article>
  );
}
