import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HubPage, ProgramPage } from "@/components/program/ProgramPage";
import { financingPath, financingSlugs, getFinancingPage } from "@/content/programs";
import { pageMetadata } from "@/lib/seo/metadata";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return financingSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getFinancingPage(slug);
  if (!page) return {};
  return pageMetadata({ title: page.entry.title, description: page.entry.description, path: financingPath(slug) });
}

export default async function FinancingPage({ params }: Props) {
  const { slug } = await params;
  const page = getFinancingPage(slug);
  if (!page) notFound();
  return page.kind === "hub" ? <HubPage entry={page.entry} /> : <ProgramPage entry={page.entry} />;
}
