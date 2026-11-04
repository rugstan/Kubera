import { serializeJsonLd, siteGraph, type JsonLdNode } from "./schemas";

/** Renders one JSON-LD block. Pass a node with `@context`, or an array of such nodes. */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

/** Organization + FinancialService + WebSite, rendered once in the site layout. */
export function SiteJsonLd() {
  return <JsonLd data={siteGraph()} />;
}
