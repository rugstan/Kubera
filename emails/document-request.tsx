import { Link, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle } from "./layout";

export type DocumentRequestProps = {
  firstName: string;
  /** Plain-text document names, e.g. "Trailing 12-month operating statement". */
  items: string[];
  /** Secure upload page (token-protected). */
  uploadUrl?: string | null;
  contactEmail: string;
};

export const documentRequestSubject = "Documents needed for your financing request";

export default function DocumentRequest({ firstName, items, uploadUrl, contactEmail }: DocumentRequestProps) {
  return (
    <EmailLayout preview="A few documents will help us move your request forward.">
      <Text style={bodyText}>Hi {firstName},</Text>
      <Text style={bodyText}>To keep your request moving, your advisor needs the following:</Text>
      <ul style={{ ...bodyText, paddingLeft: "20px" }}>
        {items.map((item) => (
          <li key={item} style={{ margin: "0 0 6px" }}>
            {item}
          </li>
        ))}
      </ul>
      <Text style={bodyText}>
        {uploadUrl ? (
          <>
            You can{" "}
            <Link href={uploadUrl} style={linkStyle}>
              upload them securely here
            </Link>{" "}
            or reply to this email.
          </>
        ) : (
          <>
            Reply to this email or write to{" "}
            <Link href={`mailto:${contactEmail}`} style={linkStyle}>
              {contactEmail}
            </Link>{" "}
            and we will tell you the best way to send them.
          </>
        )}
      </Text>
      <Text style={bodyText}>Please do not send Social Security numbers or bank account numbers by email.</Text>
    </EmailLayout>
  );
}

DocumentRequest.PreviewProps = {
  firstName: "Pat",
  items: ["Trailing 12-month operating statement", "Current rent roll"],
  uploadUrl: null,
  contactEmail: "deals@kuberacommercial.com",
} satisfies DocumentRequestProps;
