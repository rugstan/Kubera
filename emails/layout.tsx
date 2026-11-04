import { Body, Container, Head, Hr, Html, Img, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { licenseLine, site } from "@/lib/site";

// Shared frame for every transactional email. Email clients ignore CSS
// variables, so the palette is inlined here (system fonts, high contrast:
// body text 14.9:1 on white, links 7.1:1).

export const mail = {
  ink: "#1d1d1f",
  muted: "#515154",
  link: "#0050b3",
  rule: "#d2d2d7",
  canvas: "#f5f5f7",
  card: "#ffffff",
  font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const bodyText = { color: mail.ink, fontFamily: mail.font, fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" } as const;
export const mutedText = { color: mail.muted, fontFamily: mail.font, fontSize: "13px", lineHeight: "20px", margin: "0 0 8px" } as const;
export const linkStyle = { color: mail.link, textDecoration: "underline" } as const;

/**
 * The logo at the top of every email: a 640 x 163 PNG served from the site
 * (public/brand/corin-logo.png; Outlook does not show WebP). Many clients
 * block images until the reader allows them, so the alt text carries the name.
 */
export const EMAIL_LOGO = { src: `${site.siteUrl.replace(/\/$/, "")}/brand/corin-logo.png`, width: 160, height: 41 } as const;

export const BROKER_STATEMENT =
  "Corin Commercial arranges commercial real estate loans between borrowers and lenders. We are a licensed broker, not a lender, and nothing in this message is a commitment to lend or a rate lock.";

export function EmailLayout({ preview, children, footerNote }: { preview: string; children: ReactNode; footerNote?: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: mail.canvas, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: mail.card, borderRadius: "12px", maxWidth: "560px", padding: "32px" }}>
          <Img src={EMAIL_LOGO.src} alt={site.name} width={EMAIL_LOGO.width} height={EMAIL_LOGO.height} style={{ display: "block", margin: "0 0 24px", border: 0, color: mail.ink, fontFamily: mail.font, fontSize: "18px", fontWeight: 600 }} />
          <Section>{children}</Section>
          <Hr style={{ borderColor: mail.rule, margin: "24px 0" }} />
          <Text style={mutedText}>{BROKER_STATEMENT}</Text>
          {footerNote ? <Text style={mutedText}>{footerNote}</Text> : null}
          <Text style={mutedText}>{licenseLine()}</Text>
        </Container>
      </Body>
    </Html>
  );
}
