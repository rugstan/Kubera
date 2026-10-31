import { Link, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle } from "./layout";

export type LeadConfirmationProps = {
  firstName: string;
  /** Short reference the borrower can quote (first block of the lead id). */
  reference?: string;
  /** Cal.com link, when configured. */
  bookingUrl?: string | null;
  contactEmail: string;
};

export const leadConfirmationSubject = "We received your financing request";

export default function LeadConfirmation({ firstName, reference, bookingUrl, contactEmail }: LeadConfirmationProps) {
  return (
    <EmailLayout
      preview="Your financing request is with a Kubera advisor."
      footerNote="You are receiving this because you submitted a financing request on our website. Reply to this email if you would like us to stop emailing you about it."
    >
      <Text style={bodyText}>Hi {firstName},</Text>
      <Text style={bodyText}>
        Thanks for sending your financing request. An advisor will review it and follow up by email with next steps and the documents that help us match you with
        lenders.
      </Text>
      {reference ? <Text style={bodyText}>Your reference: {reference}</Text> : null}
      <Text style={bodyText}>
        {bookingUrl ? (
          <>
            If you would like to talk it through, you can{" "}
            <Link href={bookingUrl} style={linkStyle}>
              pick a time with an advisor
            </Link>
            .
          </>
        ) : (
          <>
            Questions in the meantime? Reply to this email or write to{" "}
            <Link href={`mailto:${contactEmail}`} style={linkStyle}>
              {contactEmail}
            </Link>
            .
          </>
        )}
      </Text>
    </EmailLayout>
  );
}

LeadConfirmation.PreviewProps = { firstName: "Pat", reference: "3F9A12BC", bookingUrl: null, contactEmail: "deals@kuberacommercial.com" } satisfies LeadConfirmationProps;
