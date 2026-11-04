import { Link, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle } from "./layout";

export type PortalInviteProps = {
  firstName?: string | null;
  /** Single-use borrower-portal link (token-protected). */
  portalUrl: string;
  /** When the link stops working, already formatted for the reader. */
  expiresLabel: string;
  contactEmail: string;
};

export const portalInviteSubject = "Your secure Corin Commercial document portal link";

export default function PortalInvite({ firstName, portalUrl, expiresLabel, contactEmail }: PortalInviteProps) {
  return (
    <EmailLayout preview="A private link to share documents with your advisor.">
      <Text style={bodyText}>Hi {firstName || "there"},</Text>
      <Text style={bodyText}>Your advisor set up a private portal where you can upload the documents for your financing request and answer a few questions.</Text>
      <Text style={bodyText}>
        <Link href={portalUrl} style={linkStyle}>
          Open your document portal
        </Link>
      </Text>
      <Text style={bodyText}>
        The link works once and expires {expiresLabel}. Do not forward it. If it has expired or you did not expect this email, write to{" "}
        <Link href={`mailto:${contactEmail}`} style={linkStyle}>
          {contactEmail}
        </Link>
        .
      </Text>
      <Text style={bodyText}>Please do not send Social Security numbers or bank account numbers by email; use the portal instead.</Text>
    </EmailLayout>
  );
}

PortalInvite.PreviewProps = {
  firstName: "Pat",
  portalUrl: "https://corincommercial.com/portal/access?token=example",
  expiresLabel: "on Thu, 05 Nov 2026 17:00 UTC",
  contactEmail: "deals@corincommercial.com",
} satisfies PortalInviteProps;
