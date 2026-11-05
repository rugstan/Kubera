import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketPage } from "@/components/markets/MarketPage";
import { MARKETS, getMarket, marketPath } from "@/content/markets/california";
import { pageMetadata } from "@/lib/seo/metadata";

// The rates job (app/api/cron/rates) expires the "rates" cache tag, which the
// rate ticker in app/(site)/layout.tsx uses, so this page is rendered again
// on the next visit. It awaits `params` above any <Suspense>; with Partial
// Prefetching that render fails (NEXT_STATIC_GEN_BAILOUT, a 500) unless the
// route may wait for its params, like `fallback: 'blocking'`.
export const instant = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return MARKETS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const market = getMarket(slug);
  // An unknown slug is a 404, not a page with empty metadata.
  if (!market) notFound();
  return pageMetadata({ title: market.title, description: market.description, path: marketPath(slug) });
}

export default async function MarketRoute({ params }: Props) {
  const { slug } = await params;
  const market = getMarket(slug);
  if (!market) notFound();
  return <MarketPage entry={market} />;
}
