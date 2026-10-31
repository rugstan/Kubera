import type { Metadata } from "next";
import { Suspense } from "react";
import { Qualifier } from "@/components/express/Qualifier";
import { Logo } from "@/components/site/Logo";
import { licenseLine } from "@/lib/site";

export const metadata: Metadata = {
  title: "60-Second Smart Deal Qualifier",
  description: "Tell us about your senior living, hotel, multifamily, or bridge deal and get an AI-matched financing structure in 60 seconds.",
};

export default function ExpressPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6">
        <Logo />
        <span className="flex items-center gap-1.5 text-[13px] text-titanium">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden><path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" /></svg>
          Private &amp; encrypted
        </span>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
        <Suspense fallback={<div className="bento h-[560px] animate-pulse" />}>
          <Qualifier />
        </Suspense>
      </main>
      <footer className="mx-auto w-full max-w-3xl px-5 pb-10 text-center text-[11px] leading-relaxed text-titanium">{licenseLine()}</footer>
    </div>
  );
}
