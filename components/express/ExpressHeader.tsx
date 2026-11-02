import Link from "next/link";
import { Logo } from "@/components/site/Logo";

/**
 * The express page's masthead. The logo is a link home: on kubera.loans
 * that is the qualifier itself, on corincommercial.com the full site
 * (proxy.ts decides which page `/` serves on each host).
 */
export function ExpressHeader() {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6">
      <Link href="/" aria-label="Corin Commercial home" className="-m-2 inline-flex min-h-11 items-center rounded-lg p-2">
        <Logo />
      </Link>
      <span className="flex items-center gap-1.5 text-[13px] text-titanium">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
        </svg>
        Private &amp; encrypted
      </span>
    </header>
  );
}
