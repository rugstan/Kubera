import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { CommandBar } from "@/components/ask/CommandBar";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.siteUrl),
  title: {
    default: "Kubera Commercial — Senior Living, Hospitality & CRE Debt Advisory",
    template: "%s · Kubera Commercial",
  },
  description:
    "Institutional debt advisory for senior living, hotels, and multifamily: HUD 232, SBA 504 hotel stacks, CMBS, PIP bridge, and white-label bridge financing — sized in 60 seconds.",
  openGraph: { type: "website", siteName: site.name, url: site.siteUrl },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <CommandBar />
      </body>
    </html>
  );
}
