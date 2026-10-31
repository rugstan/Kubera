import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InsightPage } from "@/components/insights/InsightPage";
import { getInsight, INSIGHTS, insightPath } from "@/content/insights";
import { pageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return INSIGHTS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const insight = getInsight(slug);
  if (!insight) return {};
  const base = pageMetadata({ title: insight.metaTitle, description: insight.description, path: insightPath(slug) });
  return {
    ...base,
    // Articles carry their own dates and section, which is what search and social cards read.
    openGraph: { ...base.openGraph, type: "article", publishedTime: insight.published, modifiedTime: insight.updated, section: insight.category },
  };
}

export default async function InsightRoute({ params }: Props) {
  const { slug } = await params;
  const insight = getInsight(slug);
  if (!insight) notFound();
  return <InsightPage insight={insight} />;
}
