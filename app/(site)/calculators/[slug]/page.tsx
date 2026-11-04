import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalculatorPage } from "@/components/calculators/CalculatorPage";
import { CALCULATORS, calculatorPath, getCalculator } from "@/content/calculators";
import { pageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return CALCULATORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = getCalculator(slug);
  // An unknown slug is a 404, not a page with empty metadata.
  if (!entry) notFound();
  return pageMetadata({ title: entry.title, description: entry.description, path: calculatorPath(slug) });
}

export default async function CalculatorRoute({ params }: Props) {
  const { slug } = await params;
  const entry = getCalculator(slug);
  if (!entry) notFound();
  return <CalculatorPage entry={entry} />;
}
