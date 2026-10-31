import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { SchedulerEmbed } from "@/components/trust/SchedulerEmbed";
import { contactPageSchema } from "@/components/trust/schemas";
import { MAILBOXES, contactDetails, mailboxAddress } from "@/content/contact";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { licenseLine, site } from "@/lib/site";

const meta = TRUST_PAGES.contact;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

export default function ContactPage() {
  const contact = contactDetails();
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to a licensed advisor."
      intro={<p>Tell us about the property and the loan you have in mind. An advisor reads every message and replies by email or phone.</p>}
      breadcrumb={[{ href: meta.path, label: "Contact" }]}
    >
      <JsonLd
        data={[
          contactPageSchema({ path: meta.path, name: "Contact Kubera Commercial", description: meta.description }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Contact", path: meta.path },
          ]),
        ]}
      />

      <Section id="reach-us" title="Reach us">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">Email</h3>
            <p className="mt-3 text-[15px]">
              <a href={`mailto:${contact.email}`} className="font-medium text-accent underline underline-offset-2">{contact.email}</a>
            </p>
            <p className="mt-2 text-[14px] text-titanium">Best for new financing requests.</p>
          </div>
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">Phone</h3>
            {contact.phone ? (
              <p className="mt-3 text-[15px]">
                {contact.telHref ? (
                  <a href={`tel:${contact.telHref}`} className="font-medium text-accent underline underline-offset-2">{contact.phone}</a>
                ) : (
                  contact.phone
                )}
              </p>
            ) : (
              <p className="mt-3 text-[15px] text-titanium">Phone number coming soon. Email or book a call for now.</p>
            )}
          </div>
          <div className="bento p-7">
            <h3 className="text-lg font-semibold">Office</h3>
            {contact.address ? (
              <address className="mt-3 text-[15px] not-italic leading-relaxed text-titanium">{contact.address}</address>
            ) : (
              <p className="mt-3 text-[15px] text-titanium">Our licensed office address appears on the licensing page.</p>
            )}
            <p className="mt-2 text-[14px] text-titanium">
              <Link href="/licensing" className="font-medium text-accent underline underline-offset-2">Licensing and disclosures</Link>
            </p>
          </div>
        </div>
      </Section>

      <Section id="schedule" title="Book a call" lead="Pick a time that works for you. A licensed advisor joins the call.">
        {contact.scheduling ? (
          <SchedulerEmbed embedUrl={contact.scheduling.embed} pageUrl={contact.scheduling.page} />
        ) : (
          <div className="bento max-w-3xl p-7">
            <p className="text-[16px] leading-relaxed text-titanium">
              Online scheduling is not set up yet. Email{" "}
              <a href={`mailto:${contact.email}`} className="font-medium text-accent underline underline-offset-2">{contact.email}</a>{" "}
              with two or three times that work for you, or start with the{" "}
              <Link href="/express" className="font-medium text-accent underline underline-offset-2">60-second qualifier</Link>.
            </p>
          </div>
        )}
      </Section>

      <Section id="mailboxes" title="Which address to use" lead="Writing to the right mailbox gets your message to the right person sooner.">
        <div role="region" aria-label="Mailbox routing" tabIndex={0} className="bento overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Which Kubera Commercial mailbox to use</caption>
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

      <Section id="not-sure" title="Not sure where to start?">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href="/express" className="pill pill-primary">Start the 60-second qualifier</Link>
          <Link href="/#sizer" className="pill pill-glass">Size a loan</Link>
          <Link href="/partners" className="pill pill-glass">Register as a partner</Link>
        </div>
      </Section>

      <LicenseFootnote>
        {licenseLine()} {site.legalName} is a broker, not a lender. Messages are not an application, and a reply is not a commitment to lend.
      </LicenseFootnote>
    </PageShell>
  );
}
