import Link from "next/link";
import { StatusPanel } from "./StatusPanel";

/** Shared 404 body for the root and (site) not-found boundaries. */
export function NotFoundContent() {
  return (
    <StatusPanel
      eyebrow="404 · Page not found"
      title="We couldn't find that page."
      actions={
        <>
          <Link href="/" className="pill pill-primary">Go to the homepage</Link>
          <Link href="/financing" className="pill pill-glass">Browse financing</Link>
          <Link href="/contact" className="pill pill-glass">Talk to an advisor</Link>
        </>
      }
    >
      <p>The link may be out of date, or the address may have a typo. Start from one of these pages, or reach a licensed advisor directly.</p>
    </StatusPanel>
  );
}
