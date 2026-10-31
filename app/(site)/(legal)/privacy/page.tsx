import Link from "next/link";
import { LegalPage, TableScroll } from "@/components/legal/LegalPage";
import { COLLECTION_POINTS, PI_CATEGORIES, PURPOSES, SERVICE_PROVIDERS } from "@/components/legal/legal";
import { legalMetadata } from "@/components/legal/metadata";
import { site } from "@/lib/site";

export const metadata = legalMetadata(
  "/privacy",
  "Privacy policy",
  "How Kubera Commercial collects, uses, shares, and keeps personal information, and how to use your California privacy rights.",
);

const collectedAtAnyForm = new Set(Object.values(COLLECTION_POINTS).flatMap((p) => p.categories));

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <p>
          {site.legalName} (&ldquo;Kubera,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a California real estate broker that arranges commercial real estate loans. This policy explains what personal
          information we collect on {site.primaryDomain} and {site.expressDomain}, and in our work with borrowers, partners, and lenders, how we use and share it, how long we keep it, and the
          choices and rights you have.
        </p>
      }
    >
      <h2 id="summary">The short version</h2>
      <ul>
        <li>We collect what you give us to review and arrange financing, plus basic device and usage data that keeps the site secure.</li>
        <li>We share your loan package with lenders and report providers only to arrange the financing you ask for.</li>
        <li>We do not sell your personal information, and we do not share it for cross-context behavioral advertising. We do not use advertising cookies.</li>
        <li>
          You can ask to know, correct, or delete your personal information by emailing <a href={`mailto:${site.privacyEmail}`}>{site.privacyEmail}</a>.
        </li>
      </ul>

      <h2 id="notice-at-collection">Notice at collection</h2>
      <p>
        This section is our notice at collection under the California Consumer Privacy Act (CCPA). The table lists each category of personal information we collect, examples, whether
        it is sensitive, and how long we keep it. We collect it for the purposes listed in <a href="#use">How we use personal information</a>. We do not sell or share any category for
        cross-context behavioral advertising.
      </p>
      <TableScroll label="Categories of personal information">
        <table>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Examples</th>
              <th scope="col">Sensitive</th>
              <th scope="col">Collected on our forms</th>
            </tr>
          </thead>
          <tbody>
            {PI_CATEGORIES.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {c.label}
                  <span className="mt-1 block text-[12px] font-normal text-titanium">CCPA: {c.ccpa}</span>
                </th>
                <td>{c.examples}</td>
                <td>{c.sensitive ? "Yes" : "No"}</td>
                <td>{collectedAtAnyForm.has(c.id) ? "Yes" : "In our work with you"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <h3 id="sources">Where it comes from</h3>
      <ul>
        <li>From you, when you use the deal qualifier, the loan sizer, Kubera AI, the partner portal, the document vault, or the newsletter signup, or when you email, call, or text us.</li>
        <li>From people you authorize, such as your referring broker, co-borrowers, accountants, and attorneys.</li>
        <li>From lenders and third-party report providers working on your loan, such as appraisers, title companies, and escrow companies.</li>
        <li>From public sources, such as property records and license lookups.</li>
        <li>Automatically from your browser or device when you visit our sites.</li>
      </ul>

      <h2 id="use">How we use personal information</h2>
      <ul>
        {PURPOSES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p>
        We use sensitive personal information only to provide the services you request, to keep our systems secure, and to meet legal duties. We do not use it to infer
        characteristics about you, so the CCPA right to limit its use does not apply. We do not use your personal information for any purpose that is materially different from those
        listed here without telling you first.
      </p>

      <h3 id="ai">Kubera AI and automated tools</h3>
      <p>
        Kubera is advisor-led and AI-assisted. Our loan sizer, deal qualifier, and Kubera AI use automated tools, including an AI model operated by Anthropic, to produce indicative
        estimates and answers. A licensed Kubera advisor reviews every engagement before anything goes to a lender, and no automated tool makes a credit decision; lenders make all
        credit decisions. Please do not enter Social Security numbers, account numbers, or other sensitive details into Kubera AI. Read{" "}
        <Link href="/privacy/ai">AI use and your choices</Link> for where we use AI, what we never send to AI tools, and how to ask for advisor-only handling.
      </p>

      <h2 id="sharing">How we share personal information</h2>
      <p>We disclose personal information for business purposes only to:</p>
      <ul>
        <li>
          <strong>Lenders and capital sources</strong> that you ask us to approach for your financing. Arranging your loan is the service you request, so we share your loan package
          with them at your direction. Each lender handles your information under its own privacy policy.
        </li>
        <li>
          <strong>Third-party report providers</strong> working on your loan, such as appraisers, environmental and property-condition consultants, title, and escrow, again at your
          direction.
        </li>
        <li>
          <strong>Service providers</strong> that process personal information for us under contracts that limit their use of it to the services they provide:
          <ul>
            {SERVICE_PROVIDERS.map((s) => (
              <li key={s.name}>
                {s.name}: {s.role}
              </li>
            ))}
          </ul>
        </li>
        <li>
          <strong>Regulators and others when the law requires it</strong>, including the California Department of Real Estate, courts, and law enforcement, or to protect our rights and
          the safety of others.
        </li>
        <li>
          <strong>A buyer or successor</strong> if we are involved in a merger, acquisition, or sale of assets, subject to this policy.
        </li>
      </ul>
      <p>
        <strong>We do not sell personal information, and we do not share it for cross-context behavioral advertising.</strong> We have not done so in the past 12 months. We do not
        knowingly collect personal information from anyone under 16.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <p>
        We keep personal information only as long as we need it for the purposes above or as the law requires. The California Department of Real Estate requires brokers to keep loan
        records, including the Mortgage Loan Disclosure Statement, for at least three years. Records under a legal hold are kept until the hold ends. When a period ends, we delete or
        de-identify the information, including stored files.
      </p>
      <TableScroll label="Retention schedule">
        <table>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">How long we keep it</th>
            </tr>
          </thead>
          <tbody>
            {PI_CATEGORIES.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.label}</th>
                <td>{c.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <h2 id="rights">Your California privacy rights</h2>
      <p>If you are a California resident, you have the right to:</p>
      <ul>
        <li>
          <strong>Know and access</strong> the personal information we have collected about you, the categories of sources, the purposes, and the categories of recipients.
        </li>
        <li>
          <strong>Delete</strong> personal information we collected from you, subject to legal exceptions such as records the Department of Real Estate requires us to keep.
        </li>
        <li>
          <strong>Correct</strong> inaccurate personal information.
        </li>
        <li>
          <strong>Opt out of sale or sharing.</strong> We do not sell or share personal information, so there is nothing to opt out of, but you may still send the request.
        </li>
        <li>
          <strong>Not be discriminated against</strong> for using any of these rights.
        </li>
      </ul>
      <h3 id="requests">How to make a request</h3>
      <p>
        Email <a href={`mailto:${site.privacyEmail}`}>{site.privacyEmail}</a>
        {site.phone ? (
          <>
            {" "}
            or call <a href={`tel:${site.phone.replace(/[^\d+]/g, "")}`}>{site.phone}</a>
          </>
        ) : null}
        . Tell us which right you want to use and how we can reach you. We will confirm receipt within 10 business days and respond within 45 calendar days. If we need more time, we
        will tell you why and may take up to another 45 days.
      </p>
      <p>
        To protect you, we verify your identity by matching information you give us with information we already have. You can ask an authorized agent to make a request for you; we
        will ask for your signed permission and may ask you to verify your identity directly.
      </p>

      <h3 id="signals">Do Not Track and Global Privacy Control</h3>
      <p>
        We do not track you across other websites or allow third parties to do so on our sites. We treat a Global Privacy Control signal from your browser as a request to opt out of
        sale and sharing. Our sites do not otherwise change their behavior in response to Do Not Track signals.
      </p>

      <h3 id="shine-the-light">Shine the Light</h3>
      <p>We do not disclose personal information to third parties for their own direct marketing purposes (Civ. Code §1798.83).</p>

      <h2 id="communications">Email, text, and phone</h2>
      <p>
        We contact you by phone, text, or email only when you have agreed to it or when you have asked us to. Agreeing is never a condition of working with us. Reply STOP to any text to
        opt out, or HELP for help. Message and data rates may apply. You can unsubscribe from marketing email with the link in any message; we may still send messages about a loan
        request you have open.
      </p>

      <h2 id="security">Security</h2>
      <p>
        We protect personal information with encryption in transit and at rest, a private document vault with expiring upload links, access limited to the people who need it, and
        security monitoring. No system is perfectly secure. If a breach affects your personal information, we will notify you as California law requires.
      </p>

      <h2 id="business-borrowers">Business borrowers</h2>
      <p>
        Most of our work involves loans to businesses. Personal information about owners, guarantors, and employees of a business is covered by this policy in the same way.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We will post any change on this page with a new effective date. If a change is material, we will also show a notice on our sites or tell you directly before it takes
        effect.
      </p>

      <h2 id="contact">Contact us</h2>
      <p>
        Questions or requests: <a href={`mailto:${site.privacyEmail}`}>{site.privacyEmail}</a>
        {site.licensedAddress ? <> · {site.licensedAddress}</> : null}. See also our <Link href="/terms">terms of use</Link> and{" "}
        <Link href="/licensing">licensing and disclosures</Link>.
      </p>
    </LegalPage>
  );
}
