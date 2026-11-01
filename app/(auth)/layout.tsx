import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: "Sign in", template: "%s · Kubera Commercial" },
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="flex min-h-dvh items-start justify-center px-4 py-16 sm:items-center">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-block rounded-md text-[15px] font-semibold tracking-tight text-ink">
          {site.name}
        </Link>
        {children}
        <p className="mt-6 text-[13px] leading-relaxed text-titanium">
          Staff sign-in only. Borrowers and partners use the secure link their advisor emails them to open the{" "}
          <Link className="text-accent underline underline-offset-2" href="/portal">
            borrower portal
          </Link>
          . Questions about your account? Email{" "}
          <a className="text-accent underline underline-offset-2" href={`mailto:${site.email}`}>
            {site.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
