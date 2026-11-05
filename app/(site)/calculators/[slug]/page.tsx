import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalculatorPage } from "@/components/calculators/CalculatorPage";
import { CALCULATORS, calculatorPath, getCalculator } from "@/content/calculators";
import { pageMetadata } from "@/lib/seo/metadata";

// The rates job (app/api/cron/rates) expires the "rates" cache tag, which the
// rate ticker in app/(site)/layout.tsx uses, so this page is rendered again
// on the next visit. It awaits `params` above any <Suspense>; with Partial
// Prefetching that render fails (NEXT_STATIC_GEN_BAILOUT, a 500) unless the
// route may wait for its params, like `fallback: 'blocking'`.
export const instant = false;

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
