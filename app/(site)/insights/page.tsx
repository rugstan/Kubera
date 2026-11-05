import type { Metadata } from "next";
import { InsightsIndex } from "@/components/insights/InsightsIndex";
import { INSIGHTS_BASE, INSIGHTS_INDEX } from "@/content/insights";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: INSIGHTS_INDEX.metaTitle, description: INSIGHTS_INDEX.description, path: INSIGHTS_BASE });

export default function InsightsPage() {
  return <InsightsIndex />;
}
