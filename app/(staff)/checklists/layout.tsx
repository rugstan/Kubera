import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/Logo";

// Staff deal desk: document checklists, conditions, principals and screening.
// WS-I's (staff) layout adds the authenticated shell; these pages also check
// the staff session themselves because layouts do not guard server actions.

export const metadata: Metadata = {
  title: { default: "Deal desk", template: "%s · Deal desk" },
  robots: { index: false, follow: false },
};

export default function ChecklistsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-black/10 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="rounded-lg">
            <Logo />
            <span className="sr-only"> home</span>
          </Link>
          <nav aria-label="Deal desk">
            <Link href="/checklists" className="text-[15px] font-medium text-accent underline-offset-2 hover:underline">
              Checklists
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </>
  );
}
