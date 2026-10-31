import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketPage } from "@/components/markets/MarketPage";
import { MARKETS, getMarket, marketPath } from "@/content/markets/california";
import { pageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return MARKETS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const market = getMarket(slug);
  if (!market) return {};
  return pageMetadata({ title: market.title, description: market.description, path: marketPath(slug) });
}

export default async function MarketRoute({ params }: Props) {
  const { slug } = await params;
  const market = getMarket(slug);
  if (!market) notFound();
  return <MarketPage entry={market} />;
}
