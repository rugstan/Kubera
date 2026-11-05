import type { Metadata } from "next";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { ProgramDisclosures } from "@/components/program/parts";
import { PageContainer } from "@/components/site/PageContainer";
import { NEWSLETTER_PATH, NEWSLETTER_PAGE } from "@/content/newsletter";
import { pageMetadata } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";

export const metadata: Metadata = pageMetadata({ title: NEWSLETTER_PAGE.title, description: NEWSLETTER_PAGE.description, path: NEWSLETTER_PATH });

export default function NewsletterPage() {
  return (
    <PageContainer className="py-12 md:py-20">
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Newsletter", path: NEWSLETTER_PATH },
        ])}
      />
      {/* From lg: what the newsletter is on the left, the signup beside it. A phone reads them in that order. */}
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-12 xl:gap-16">
        <div>
          <header>
            <p className="eyebrow">Newsletter</p>
            <h1 className="mt-3 text-4xl font-semibold md:text-5xl">Commercial real estate debt, once a month</h1>
            <p className="mt-5 text-lg leading-relaxed text-ink/85">{NEWSLETTER_PAGE.lead}</p>
          </header>
          <ul className="mt-8 list-disc space-y-2 pl-6 text-[17px] leading-relaxed text-ink/85">
            {NEWSLETTER_PAGE.promises.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <NewsletterSignup source={NEWSLETTER_PATH} />
      </div>
      <ProgramDisclosures />
    </PageContainer>
  );
}
