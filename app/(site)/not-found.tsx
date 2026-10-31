import { NotFoundContent } from "@/components/site/NotFoundContent";

// notFound() from a marketing route ([slug] pages under financing, insights,
// structures, calculators, california) renders inside the (site) layout, which
// already provides the header, <main id="main-content"> and footer.
export default function SiteNotFound() {
  return <NotFoundContent />;
}
