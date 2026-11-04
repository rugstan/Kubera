import "@fontsource-variable/inter/opsz.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Analytics } from "@/components/analytics/Analytics";
import { MotionProvider } from "@/components/ui/MotionProvider";
import { SkipLink } from "@/components/ui/SkipLink";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.siteUrl),
  title: {
    default: "Corin Commercial | Commercial Real Estate Loan Broker",
    template: "%s · Corin Commercial",
  },
  description:
    "Licensed California loan broker for senior living, hotel, multifamily, construction and hard money financing: HUD, SBA, CMBS, agency, bank and private lenders.",
  openGraph: { type: "website", siteName: site.name },
  // No site-wide robots tag: indexing is the default, and a root "index, follow"
  // would also land on every not-found page next to Next's injected noindex.
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <SkipLink />
        <MotionProvider>
          {children}
        </MotionProvider>
        <Analytics />
      </body>
    </html>
  );
}
