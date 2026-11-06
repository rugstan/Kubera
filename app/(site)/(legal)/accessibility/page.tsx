import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/components/legal/metadata";
import { site } from "@/lib/site";

export const metadata = legalMetadata(
  "/accessibility",
  "Accessibility statement",
  "Corin Commercial's commitment to WCAG 2.2 AA accessibility, what we test, known limitations, and how to reach us if something does not work for you.",
);

const LAST_REVIEWED = "November 2, 2026";

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility statement"
      path="/accessibility"
      intro={
        <p>
          We want everyone to be able to use our sites, including people who use screen readers, keyboards, magnification, captions, or other assistive technology. Our goal is to
          meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.
        </p>
      }
    >
      <h2 id="what-we-do">What we do</h2>
      <ul>
        <li>Design for text contrast of at least 4.5:1 and a visible focus indicator on every interactive element.</li>
        <li>Make every form, tab, dialog, and menu usable with a keyboard alone.</li>
        <li>Label form fields and announce errors and status messages to screen readers.</li>
        <li>Respect your system&apos;s reduced-motion setting and let you pause moving content, such as the rate ticker.</li>
        <li>Test key pages with automated tools and by hand with a keyboard and screen reader before we release changes.</li>
      </ul>

      <h2 id="limitations">Known limitations</h2>
      <ul>
        <li>Some documents we receive from lenders and third parties, such as term sheets and reports, may not be fully accessible. We can provide another format on request.</li>
      </ul>

      <h2 id="other-ways">Other ways to work with us</h2>
      <p>
        You never need to use our online tools to work with us. An advisor can take your loan request by email
        {site.phone ? " or phone" : ""}, and we can send any document in a format that works for you.
      </p>

      <h2 id="feedback">Feedback and help</h2>
      <p>
        If something on our sites does not work for you, tell us what page you were on and what happened. Email <a href={`mailto:${site.email}`}>{site.email}</a>
        {site.phone ? (
          <>
            {" "}
            or call <a href={`tel:${site.phone.replace(/[^\d+]/g, "")}`}>{site.phone}</a>
          </>
        ) : null}
        . We aim to respond within two business days.
      </p>

      <h2 id="review">Last reviewed</h2>
      <p>
        We last reviewed this statement on {LAST_REVIEWED}. See also our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">terms of use</Link>.
      </p>
    </LegalPage>
  );
}
