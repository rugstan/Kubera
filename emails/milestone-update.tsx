import { Link, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle } from "./layout";

export type MilestoneUpdateProps = {
  firstName: string;
  /** Short milestone name, e.g. "Lender outreach". */
  label: string;
  /** One or two sentences from the milestone catalog (lib/notify/stage-events.ts). */
  message: string;
  bookingUrl?: string | null;
  contactEmail: string;
};

export const milestoneUpdateSubject = (label: string) => `Update on your financing request: ${label}`;

export default function MilestoneUpdate({ firstName, label, message, bookingUrl, contactEmail }: MilestoneUpdateProps) {
  return (
    <EmailLayout
      preview={`${label}: an update on your financing request.`}
      footerNote="You are receiving this update because you agreed to be contacted about this financing request. Reply to this email if you would like these updates to stop."
    >
      <Text style={bodyText}>Hi {firstName},</Text>
      <Text style={{ ...bodyText, fontWeight: 600 }}>{label}</Text>
      <Text style={bodyText}>{message}</Text>
      <Text style={bodyText}>
        {bookingUrl ? (
          <>
            Want to talk it through?{" "}
            <Link href={bookingUrl} style={linkStyle}>
              Pick a time with your advisor
            </Link>
            .
          </>
        ) : (
          <>
            Questions? Reply to this email or write to{" "}
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

MilestoneUpdate.PreviewProps = {
  firstName: "Pat",
  label: "Lender outreach",
  message: "Your loan package is being shared with lenders whose programs fit your request.",
  bookingUrl: null,
  contactEmail: "deals@corincommercial.com",
} satisfies MilestoneUpdateProps;
