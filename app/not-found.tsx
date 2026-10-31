import type { Metadata } from "next";
import { Footer } from "@/components/site/Footer";
import { GlassHeader } from "@/components/site/GlassHeader";
import { NotFoundContent } from "@/components/site/NotFoundContent";

// Unmatched URLs anywhere in the app land here, inside the root layout only,
// so this page brings its own header, <main> landmark (the skip-link target)
// and footer with the license line. Next adds the robots noindex tag itself.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <>
      <GlassHeader />
      <main id="main-content">
        <NotFoundContent />
      </main>
      <Footer />
    </>
  );
}
