import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HubPage, ProgramPage } from "@/components/program/ProgramPage";
import { financingPath, financingSlugs, getFinancingPage } from "@/content/programs";
import { pageMetadata } from "@/lib/seo/metadata";

// The rates job (app/api/cron/rates) expires the "rates" cache tag, which the
// rate ticker in app/(site)/layout.tsx uses, so this page is rendered again
// on the next visit. It awaits `params` above any <Suspense>; with Partial
// Prefetching that render fails (NEXT_STATIC_GEN_BAILOUT, a 500) unless the
// route may wait for its params, like `fallback: 'blocking'`.
export const instant = false;

// After the rates job a visit must re-render the whole page as static HTML.
// Without this the stale path is answered from the route's generic fallback
// shell plus a per-request resume, sent as `Cache-Control: private, no-store`
// and about 60% heavier, which is what crawlers saw on most visits.
export const ensureStatic = "navigation";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return financingSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getFinancingPage(slug);
  // An unknown slug is a 404, not a page with empty metadata.
  if (!page) notFound();
  return pageMetadata({ title: page.entry.title, description: page.entry.description, path: financingPath(slug) });
}

export default async function FinancingPage({ params }: Props) {
  const { slug } = await params;
  const page = getFinancingPage(slug);
  if (!page) notFound();
  return page.kind === "hub" ? <HubPage entry={page.entry} /> : <ProgramPage entry={page.entry} />;
}
