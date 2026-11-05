import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/components/legal/metadata";
import { disclosures, site } from "@/lib/site";

export const metadata = legalMetadata(
  "/terms",
  "Terms of use",
  "The terms that apply when you use Corin Commercial's websites, loan sizer, deal qualifier, document vault, and partner portal.",
);

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      path="/terms"
      intro={
        <p>
          These terms apply when you use {site.primaryDomain}, {site.expressDomain}, and the tools on them, including the loan sizer, the deal qualifier, the document vault,
          and the partner portal (together, the &ldquo;sites&rdquo;). By using the sites you agree to these terms. If you do not agree, please do not use the sites.
        </p>
      }
    >
      <h2 id="who-we-are">Who we are</h2>
      <p>
        {site.legalName} is a California real estate corporation licensed by the California Department of Real Estate. {disclosures.brokerNotLender} See{" "}
        <Link href="/licensing">licensing and disclosures</Link> for our license details.
      </p>

      <h2 id="no-offer">Estimates, not offers</h2>
      <p>{disclosures.indicative}</p>
      <ul>
        <li>Nothing on the sites is an offer to lend, a loan approval, a commitment, or a rate lock. Only a lender can approve or commit to a loan, in writing.</li>
        <li>Program-fit results, sizing, rates, and costs depend on what you enter and on market assumptions that change. Actual terms can differ materially.</li>
        <li>{disclosures.timeline}</li>
        <li>Whether California usury limits apply to a particular loan depends on its facts. We do not make that determination for you; ask your own counsel.</li>
      </ul>

      <h2 id="automated-tools">Estimates and automated tools</h2>
      <p>
        Our loan sizer, deal qualifier, calculators, and other online tools produce results automatically from what you enter and from market assumptions. Results can be wrong or
        incomplete. They are not legal, tax, accounting, or investment advice, and a licensed Corin advisor reviews every engagement. Check anything important with your advisor and
        your own professionals.
      </p>

      <h2 id="your-information">What you send us</h2>
      <ul>
        <li>You agree that the information and documents you submit are accurate to the best of your knowledge and that you have the right to share them.</li>
        <li>
          You authorize us to use them to review and arrange financing, including sharing your loan package with lenders and third-party report providers, as our{" "}
          <Link href="/privacy">privacy policy</Link> describes.
        </li>
        <li>Do not upload information about other people unless you are allowed to share it with us for this purpose.</li>
      </ul>

      <h2 id="engagement">Working with us on a loan</h2>
      <p>
        Using the sites does not by itself make Corin your broker. An engagement starts only when you and Corin sign a written agreement. For loans secured by real property, you will
        receive a Mortgage Loan Disclosure Statement before you are obligated on any loan, as described on our <Link href="/licensing">licensing page</Link>.
      </p>

      <h2 id="partners">Partner registrations</h2>
      <p>
        Registering in the partner portal does not create a referral, co-brokerage, or fee agreement. Any compensation to a partner is paid only under a signed written agreement and only
        as California law permits, including Business and Professions Code §10137, which limits compensation to unlicensed persons for acts that require a license.
      </p>

      <h2 id="communications">Communications</h2>
      <p>
        If you agree to be contacted, we may reach you by phone, text, or email about your request. Agreeing is not a condition of any service. Reply STOP to opt out of texts. See the{" "}
        <Link href="/privacy#communications">privacy policy</Link> for details.
      </p>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>submit false information or information about someone else without permission;</li>
        <li>probe, scan, or test the sites for vulnerabilities, or bypass security, rate limits, or bot protection;</li>
        <li>scrape the sites or their tools in bulk, or use them to build a competing product;</li>
        <li>misrepresent results from the sites as an offer, a commitment, or advice from Corin; or</li>
        <li>upload malware or files you do not have the right to share.</li>
      </ul>
      <p>We may suspend access or remove content that breaks these rules.</p>

      <h2 id="ip">Our content</h2>
      <p>
        The sites, their design, text, software, and the Corin name and logo belong to Corin or its licensors. You may view and print pages for your own business use. HUD, FHA, SBA,
        Fannie Mae, Freddie Mac, and other program names are used descriptively; Corin is not affiliated with or endorsed by any government agency or program sponsor.
      </p>

      <h2 id="third-party">Third-party sites and data</h2>
      <p>
        Rates and benchmarks come from third parties, such as the Federal Reserve Bank of St. Louis (FRED), and may be delayed or inaccurate. Links to other sites are for convenience;
        we are not responsible for their content or practices.
      </p>

      <h2 id="disclaimers">Disclaimers</h2>
      <p>
        The sites are provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; To the fullest extent the law allows, Corin disclaims all warranties, express or implied, including
        merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the sites will be uninterrupted or error-free.
      </p>

      <h2 id="liability">Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, Corin is not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits or lost financing
        opportunities, arising from your use of the sites. Corin&apos;s total liability for any claim about the sites is limited to $100. These limits do not apply to liability that
        cannot be limited by law, and they do not change any duty Corin owes you under a signed engagement or under the Real Estate Law.
      </p>

      <h2 id="indemnity">Indemnity</h2>
      <p>
        You agree to indemnify Corin against third-party claims arising from information you submit without the right to do so or from your breach of these terms.
      </p>

      <h2 id="law">Governing law</h2>
      <p>
        These terms are governed by California law, without regard to conflict-of-law rules. Any dispute about the sites will be brought in the state or federal courts located in
        California, unless a signed agreement between you and Corin says otherwise.
      </p>

      <h2 id="changes">Changes</h2>
      <p>We may update these terms by posting a new version with a new effective date. Continued use after a change means you accept it.</p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${site.email}`}>{site.email}</a>
        {site.licensedAddress ? <> · {site.licensedAddress}</> : null}.
      </p>
    </LegalPage>
  );
}
