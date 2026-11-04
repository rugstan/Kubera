import Link from "next/link";
import { LegalPage, TableScroll } from "@/components/legal/LegalPage";
import { legalMetadata } from "@/components/legal/metadata";
import { disclosures, dreLookupUrl, licenseLine, site } from "@/lib/site";

export const metadata = legalMetadata(
  "/licensing",
  "Licensing and disclosures",
  "Corin Commercial's California DRE broker licenses, how we are paid, and the Mortgage Loan Disclosure Statement you receive on loans secured by real property.",
);

function LicenseId({ id }: { id: string }) {
  // Production builds cannot reach this branch for the corporate license: the
  // guard in lib/site.ts fails the build when it is missing.
  if (!id) return <>(pending configuration)</>;
  return (
    <>
      #{id}{" "}
      <a href={dreLookupUrl(id)} target="_blank" rel="noopener noreferrer">
        Verify with the DRE<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </>
  );
}

export default function LicensingPage() {
  return (
    <LegalPage
      title="Licensing and disclosures"
      intro={
        <p>
          {site.legalName} is a real estate broker licensed by the California Department of Real Estate (DRE). We arrange commercial real estate loans for our clients. We are not a lender.
        </p>
      }
    >
      <h2 id="licenses">Our licenses</h2>
      <TableScroll label="License details">
        <table>
          <tbody>
            <tr>
              <th scope="row">Licensee</th>
              <td>{site.legalName}, real estate corporation</td>
            </tr>
            <tr>
              <th scope="row">Regulator</th>
              <td>California Department of Real Estate</td>
            </tr>
            <tr>
              <th scope="row">Corporate broker license</th>
              <td>
                <LicenseId id={site.dreCorporateLicense} />
              </td>
            </tr>
            <tr>
              <th scope="row">Designated officer</th>
              <td>
                {site.designatedOfficer}
                {site.dreOfficerLicense && (
                  <>
                    , broker license <LicenseId id={site.dreOfficerLicense} />
                  </>
                )}
              </td>
            </tr>
            {site.nmls && (
              <tr>
                <th scope="row">NMLS ID</th>
                <td>#{site.nmls}</td>
              </tr>
            )}
            {site.licensedAddress && (
              <tr>
                <th scope="row">Main office (licensed address)</th>
                <td>{site.licensedAddress}</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      <p>
        You can look up any California real estate license on the{" "}
        <a href="https://www.dre.ca.gov/" target="_blank" rel="noopener noreferrer">
          DRE website<span className="sr-only"> (opens in a new tab)</span>
        </a>
        , where you can also file a complaint.
      </p>
      <p className="text-[14px]">Advertising statement: {licenseLine()}</p>

      <h2 id="broker-not-lender">Broker, not lender</h2>
      <p>{disclosures.brokerNotLender}</p>
      <ul>
        <li>We find and negotiate with lenders for you. The lender you choose underwrites, approves, documents, and funds your loan as lender of record.</li>
        <li>We do not accept, hold, transfer, or disburse borrower, investor, or loan funds, and we do not use broker-controlled funds to make any loan.</li>
        <li>We do not service loans, and we have no role in construction draws, draw inspections, or lien waivers. Your lender and its servicer handle those.</li>
        <li>No result on our sites is an approval or a commitment. Only a lender can approve a loan, in writing.</li>
      </ul>

      <h2 id="mlds">Mortgage Loan Disclosure Statement</h2>
      <p>{disclosures.mlds}</p>
      <p>The statement shows, among other things:</p>
      <ul>
        <li>the estimated maximum costs you will pay, such as appraisal, escrow, title, notary, and recording fees;</li>
        <li>all compensation Corin will receive on the loan, including anything the lender pays us;</li>
        <li>the proposed loan amount, terms, and payments;</li>
        <li>that credit life or disability insurance is not required; and</li>
        <li>our name, license number, and licensed address.</li>
      </ul>
      <p>
        The figures are estimates. Each borrower and a licensed Corin broker sign it, and you receive an exact copy. You can sign electronically if you agree to do business
        electronically. We keep the signed statement for at least three years, as the DRE requires. We do not send you a loan commitment or loan documents to sign until the
        statement is signed.
      </p>
      <p>
        Some business loans are not secured by real property, such as an SBA 7(a) loan secured only by business assets. No Mortgage Loan Disclosure Statement applies to those, and
        we review each one individually before we arrange it, because different licensing rules may apply.
      </p>

      <h2 id="compensation">How we are paid</h2>
      <p>
        We may be paid by you, by the lender, or by both, and only as agreed in writing. Every amount we receive on a loan secured by real property, including any lender-paid
        compensation, appears on your Mortgage Loan Disclosure Statement. We share compensation with other brokers only under signed agreements and only as California law permits.
      </p>

      <h2 id="usury">Interest rate limits</h2>
      <p>
        California limits the interest some lenders may charge. Certain loans arranged by a licensed real estate broker are exempt from those limits, but whether any particular loan
        qualifies depends on its facts. We do not advise whether any specific loan falls within an exemption. Please ask your own counsel.
      </p>

      <h2 id="programs">Government programs</h2>
      <p>
        HUD, FHA, SBA, Fannie Mae, and Freddie Mac programs are offered through approved lenders. Corin is not affiliated with or endorsed by any government agency or program sponsor,
        and program availability, limits, and fees can change.
      </p>

      <h2 id="related">Related pages</h2>
      <ul>
        <li>
          <Link href="/privacy">Privacy policy</Link>
        </li>
        <li>
          <Link href="/terms">Terms of use</Link>
        </li>
        <li>
          <Link href="/accessibility">Accessibility statement</Link>
        </li>
      </ul>
    </LegalPage>
  );
}
