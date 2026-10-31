import { Link, render, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle, mutedText } from "@/emails/layout";

// The double opt-in confirmation email. It is a transactional reply to the
// person's own signup, versioned like the WS-J templates: bump `version`
// whenever the wording changes, because pre-approval is tied to the version.

export const NEWSLETTER_CONFIRMATION_TEMPLATE = { id: "newsletter_confirmation", version: 1 } as const;
export const newsletterConfirmationSubject = "Confirm your Kubera Commercial newsletter subscription";

export type NewsletterConfirmationProps = { confirmUrl: string; contactEmail: string };

export default function NewsletterConfirmation({ confirmUrl, contactEmail }: NewsletterConfirmationProps) {
  return (
    <EmailLayout
      preview="One click to confirm your subscription."
      footerNote="You are receiving this because someone entered this address on kuberacommercial.com to subscribe to our newsletter. If that was not you, ignore this email and you will not be subscribed."
    >
      <Text style={bodyText}>Thanks for signing up for the Kubera Commercial newsletter.</Text>
      <Text style={bodyText}>
        Please confirm your address so we know it is yours:{" "}
        <Link href={confirmUrl} style={linkStyle}>
          confirm my subscription
        </Link>
        .
      </Text>
      <Text style={mutedText}>The link works for seven days. After you confirm, you will get market notes and program updates about once a month, and every email has an unsubscribe link.</Text>
      <Text style={mutedText}>
        Questions? Write to{" "}
        <Link href={`mailto:${contactEmail}`} style={linkStyle}>
          {contactEmail}
        </Link>
        .
      </Text>
    </EmailLayout>
  );
}

NewsletterConfirmation.PreviewProps = { confirmUrl: "https://kuberacommercial.com/newsletter/confirm?token=example", contactEmail: "deals@kuberacommercial.com" } satisfies NewsletterConfirmationProps;

export async function renderNewsletterConfirmation(props: NewsletterConfirmationProps): Promise<{ subject: string; html: string; text: string }> {
  const element = <NewsletterConfirmation {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: newsletterConfirmationSubject, html, text };
}
