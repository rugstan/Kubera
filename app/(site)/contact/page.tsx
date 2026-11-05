import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseId } from "@/components/trust/LicenseId";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { SchedulerEmbed } from "@/components/trust/SchedulerEmbed";
import { HEADER_CTA, SIZER_LINK } from "@/components/site/nav";
import { contactPageSchema } from "@/components/trust/schemas";
import { MAILBOXES, callLink, contactDetails, mailboxAddress } from "@/content/contact";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { licenseLine, site } from "@/lib/site";

const meta = TRUST_PAGES.contact;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

export default function ContactPage() {
  const contact = contactDetails();
  // "Book a call" jumps to the scheduler below once online booking is set up; until then it is "Email an advisor".
  const call = callLink();
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to a licensed advisor."
      intro={
        <>
          <p>Tell us about the property and the loan you have in mind. An advisor reads every message and replies by email or phone.</p>
          {/* The actions sit above the fold, before any mailbox detail. */}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href={HEADER_CTA.href} className="pill pill-primary">{HEADER_CTA.label}</Link>
            <a href={call.kind === "book" ? "#schedule" : call.href} className="pill pill-secondary">{call.label}</a>
          </div>
          {contact.telHref && (
            <p className="mt-4 text-[15px]">
              Or call{" "}
              <a href={`tel:${contact.telHref}`} className="font-medium text-accent underline underline-offset-2">{contact.phone}</a>
            </p>
          )}
        </>
      }
      breadcrumb={[{ href: meta.path, label: "Contact" }]}
    >
      <JsonLd
        data={[
          contactPageSchema({ path: meta.path, name: "Contact Corin Commercial", description: meta.description }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Contact", path: meta.path },
          ]),
        ]}
      />

      <Section id="reach-us" title="Reach us">
        {/* The phone card shows only once NEXT_PUBLIC_CONTACT_PHONE is set: no "coming soon" placeholders. */}
        <div className={`grid gap-5 ${contact.phone ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">Email</h3>
            <p className="mt-3 text-[15px]">
              <a href={`mailto:${contact.email}`} className="font-medium text-accent underline underline-offset-2 [overflow-wrap:anywhere]">{contact.email}</a>
            </p>
            <p className="mt-2 text-[14px] text-titanium">Best for new financing requests.</p>
          </div>
          {contact.phone && (
            <div className="bento p-7">
              <h3 className="text-lg font-semibold">Phone</h3>
              <p className="mt-3 text-[15px]">
                {contact.telHref ? (
                  <a href={`tel:${contact.telHref}`} className="font-medium text-accent underline underline-offset-2">{contact.phone}</a>
                ) : (
                  contact.phone
                )}
              </p>
            </div>
          )}
          {/* The office card needs a real address (NEXT_PUBLIC_OFFICE_ADDRESS or the DRE licensed address);
              without one, the card shows the license instead of asking visitors to email for it. */}
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">{contact.address ? "Office" : "Licensing"}</h3>
            {contact.address ? (
              <address className="mt-3 text-[15px] not-italic leading-relaxed text-titanium">{contact.address}</address>
            ) : (
              <p className="mt-3 text-[15px] leading-relaxed text-titanium">
                {site.legalName} is a licensed California real estate broker. DRE Corp. License <LicenseId id={site.dreCorporateLicense} />
              </p>
            )}
            <p className="mt-2 text-[14px] text-titanium">
              <Link href="/licensing" className="font-medium text-accent underline underline-offset-2">Licensing and disclosures</Link>
            </p>
          </div>
        </div>
      </Section>

      {contact.scheduling ? (
        <Section id="schedule" title="Book a call" lead="Pick a time that works for you. A licensed advisor joins the call.">
          <SchedulerEmbed embedUrl={contact.scheduling.embed} pageUrl={contact.scheduling.page} />
        </Section>
      ) : (
        // Without NEXT_PUBLIC_CALCOM_LINK the section keeps its #schedule anchor for old links and asks for times by email.
        <Section id="schedule" title="Set up a call" lead="A licensed advisor will send you an invitation.">
          <div className="bento p-7">
            <p className="max-w-3xl text-[16px] leading-relaxed text-titanium">
              Email{" "}
              <a href={`mailto:${contact.email}`} className="font-medium text-accent underline underline-offset-2 [overflow-wrap:anywhere]">{contact.email}</a>{" "}
              with two or three times that work for you and a line about the property. To share the numbers first, use{" "}
              <Link href={HEADER_CTA.href} className="font-medium text-accent underline underline-offset-2">{HEADER_CTA.label}</Link>.
            </p>
          </div>
        </Section>
      )}

      <Section id="not-sure" title="Not sure where to start?">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href={HEADER_CTA.href} className="pill pill-primary">
            {HEADER_CTA.label}
          </Link>
          <Link href={SIZER_LINK.href} className="pill pill-glass">
            {SIZER_LINK.label}
          </Link>
        </div>
        <p className="mt-5 text-[14px] text-titanium">
          Lender, referral broker or vendor?{" "}
          <Link href="/partners" className="font-medium text-accent underline underline-offset-2">Register as a partner</Link>.
        </p>
      </Section>

      <Section id="mailboxes" title="Which address to use" lead="Writing to the right mailbox gets your message to the right person sooner.">
        <div role="region" aria-label="Mailbox routing" tabIndex={0} className="bento overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Which Corin Commercial mailbox to use</caption>
            <thead>
              <tr className="border-b border-black/10 text-ink">
                <th scope="col" className="px-6 py-3 font-semibold">Write to</th>
                <th scope="col" className="px-6 py-3 font-semibold">If you are</th>
                <th scope="col" className="px-6 py-3 font-semibold">Use it for</th>
              </tr>
            </thead>
            <tbody>
              {MAILBOXES.map((m) => (
                <tr key={m.local} className="border-b border-black/[0.06] last:border-none">
                  <th scope="row" className="px-6 py-4 align-top font-medium">
                    <a href={`mailto:${mailboxAddress(m.local)}`} className="text-accent underline underline-offset-2">{mailboxAddress(m.local)}</a>
                    {m.aliases && (
                      <span className="mt-1 block text-[12px] font-normal text-titanium">
                        Also reaches us at {m.aliases.map((a) => mailboxAddress(a)).join(", ")}
                      </span>
                    )}
                  </th>
                  <td className="px-6 py-4 align-top text-titanium">{m.audience}</td>
                  <td className="px-6 py-4 align-top text-titanium">{m.useFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 max-w-3xl text-[14px] leading-relaxed text-titanium">
          Please do not email Social Security numbers, bank account numbers or other sensitive documents. Your advisor will send a secure upload link when it is time to share documents. Privacy requests can go to{" "}
          <a href={`mailto:${site.privacyEmail}`} className="font-medium text-accent underline underline-offset-2">{site.privacyEmail}</a>.
        </p>
      </Section>

      <LicenseFootnote>
        {licenseLine()}. {site.legalName} is a broker, not a lender. Messages are not an application, and a reply is not a commitment to lend.
      </LicenseFootnote>
    </PageShell>
  );
}
