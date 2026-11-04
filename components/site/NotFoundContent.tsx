import Link from "next/link";
import { HEADER_CTA } from "./nav";
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
          <Link href={HEADER_CTA.href} className="pill pill-glass">
            {HEADER_CTA.label}
          </Link>
        </>
      }
    >
      <p>
        The link may be out of date, or the address may have a typo. Start from one of these pages, or{" "}
        <Link href="/contact" className="font-medium text-accent underline underline-offset-2">
          contact a licensed advisor
        </Link>{" "}
        directly.
      </p>
    </StatusPanel>
  );
}
