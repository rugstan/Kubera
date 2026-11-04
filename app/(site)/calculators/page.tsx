import type { Metadata } from "next";
import { CalculatorsIndex } from "@/components/calculators/CalculatorPage";
import { CALCULATORS_BASE, CALCULATORS_INDEX } from "@/content/calculators";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: CALCULATORS_INDEX.title, description: CALCULATORS_INDEX.description, path: CALCULATORS_BASE });

export default function CalculatorsPage() {
  return <CalculatorsIndex />;
}
