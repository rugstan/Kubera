import { Link, Text } from "@react-email/components";
import { bodyText, EmailLayout, linkStyle } from "./layout";

export type StaffAlertProps = {
  title: string;
  /** Plain-text lines shown under the title. */
  lines: string[];
  /** Deep link into the staff app or CRM. */
  link?: { href: string; label: string } | null;
};

export const staffAlertSubject = (title: string) => `[Kubera] ${title}`;

export default function StaffAlert({ title, lines, link }: StaffAlertProps) {
  return (
    <EmailLayout preview={title}>
      <Text style={{ ...bodyText, fontSize: "20px", fontWeight: 600 }}>{title}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={bodyText}>
          {line}
        </Text>
      ))}
      {link ? (
        <Text style={bodyText}>
          <Link href={link.href} style={linkStyle}>
            {link.label}
          </Link>
        </Text>
      ) : null}
      <Text style={bodyText}>Internal alert for Kubera staff. Do not forward outside the company.</Text>
    </EmailLayout>
  );
}

StaffAlert.PreviewProps = {
  title: "Tier-1 lead: $12.0M hotel refinance",
  lines: ["Reference 3F9A12BC", "Phone and text consent on file: yes"],
  link: { href: "https://kuberacommercial.com/pipeline", label: "Open the pipeline" },
} satisfies StaffAlertProps;
