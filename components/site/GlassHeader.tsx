"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { openCommandBar } from "@/components/ask/events";
import { Logo } from "./Logo";

const NAV = [
  { href: "/#senior-living", label: "Senior living" },
  { href: "/#hospitality", label: "Hospitality" },
  { href: "/#multifamily", label: "Multifamily and CRE" },
  { href: "/#rates", label: "Rates" },
  { href: "/partners", label: "Partners" },
];

export function GlassHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="glass sticky top-0 z-40 border-b border-black/[0.06]">
      <nav className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-5 md:px-8" aria-label="Primary">
        <Link href="/" className="flex items-center gap-2" aria-label="Kubera Commercial home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-7 text-[13px] text-ink/80 lg:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="transition-colors hover:text-ink">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCommandBar()}
            className="hidden items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-3 py-1.5 text-[13px] text-titanium transition hover:text-ink sm:flex"
          >
            <SparkIcon />
            Ask Kubera AI
            <kbd className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-sans text-[12px]">⌘K</kbd>
          </button>
          <Link href="/#sizer" className="pill pill-primary !px-4 !py-1.5 !text-[13px]">
            Size a loan
          </Link>
          <button
            type="button"
            className="ml-1 grid size-9 place-items-center rounded-full lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 h-px w-4 bg-ink transition ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 h-px w-4 bg-ink transition ${open ? "top-1.5 -rotate-45" : "top-3"}`} />
            </span>
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.ul
            id="mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="overflow-hidden border-t border-black/[0.06] px-5 lg:hidden"
          >
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-black/[0.04] last:border-none">
                <Link href={n.href} onClick={() => setOpen(false)} className="block py-3.5 text-[17px] font-medium">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => { setOpen(false); openCommandBar(); }} className="block w-full py-3.5 text-left text-[17px] font-medium text-accent">
                Ask Kubera AI
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </header>
  );
}

export function SparkIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Zm5 10c.2 1.8 1 2.6 2.8 2.8-1.8.2-2.6 1-2.8 2.8-.2-1.8-1-2.6-2.8-2.8 1.8-.2 2.6-1 2.8-2.8Z" />
    </svg>
  );
}
