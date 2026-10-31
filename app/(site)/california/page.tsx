import type { Metadata } from "next";
import { CaliforniaIndex } from "@/components/markets/MarketPage";
import { CALIFORNIA_BASE, CALIFORNIA_INDEX } from "@/content/markets/california";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: CALIFORNIA_INDEX.title, description: CALIFORNIA_INDEX.description, path: CALIFORNIA_BASE });

export default function CaliforniaPage() {
  return <CaliforniaIndex />;
}
