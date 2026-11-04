import type { Metadata } from "next";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { ProgramDisclosures } from "@/components/program/parts";
import { NEWSLETTER_PATH, NEWSLETTER_PAGE } from "@/content/newsletter";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: NEWSLETTER_PAGE.title, description: NEWSLETTER_PAGE.description, path: NEWSLETTER_PATH });

export default function NewsletterPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
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
      <NewsletterSignup source={NEWSLETTER_PATH} className="mt-10" />
      <ProgramDisclosures />
    </div>
  );
}
