"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { openCommandBar } from "@/components/ask/events";
import { Logo } from "./Logo";

const NAV = [
  { href: "/financing", label: "Financing" },
  { href: "/financing/senior-living", label: "Senior living" },
  { href: "/financing/hotels", label: "Hotels" },
  { href: "/financing/multifamily", label: "Multifamily" },
  { href: "/rates", label: "Rates" },
  { href: "/insights", label: "Insights" },
  { href: "/calculators", label: "Calculators" },
  { href: "/glossary", label: "Glossary" },
  { href: "/partners", label: "Partners" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// The desktop bar groups the asset-class pages under a "Financing" disclosure so
// the row fits on one line at the xl breakpoint with every AI entry point shown.
// The mobile menu (and the footer) keep listing every page directly.
const FINANCING_MENU = [
  { href: "/financing", label: "All financing" },
  { href: "/financing/senior-living", label: "Senior living" },
  { href: "/financing/hotels", label: "Hotels" },
  { href: "/financing/multifamily", label: "Multifamily" },
];
const DESKTOP_LINKS = NAV.filter((n) => !n.href.startsWith("/financing"));

export function GlassHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="glass sticky top-0 z-40 border-b border-black/[0.06]">
      <nav className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-4 px-5 md:px-8" aria-label="Primary">
        <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap" aria-label="Kubera Commercial home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-7 text-[13px] text-ink/80 xl:flex">
          <li>
            <FinancingMenu />
          </li>
          {DESKTOP_LINKS.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="whitespace-nowrap transition-colors hover:text-ink">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openCommandBar()}
            data-ask-entry
            className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-black/[0.08] bg-white/60 px-3 py-1.5 text-[13px] text-titanium transition hover:text-ink sm:flex"
          >
            <SparkIcon />
            Ask Kubera AI
            <kbd className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-sans text-[12px]">⌘K</kbd>
          </button>
          <Link href="/#sizer" className="pill pill-primary whitespace-nowrap !px-4 !py-1.5 !text-[13px]">
            Size a loan
          </Link>
          <button
            type="button"
            className="ml-1 grid size-9 place-items-center rounded-full xl:hidden"
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
            className="overflow-hidden border-t border-black/[0.06] px-5 xl:hidden"
          >
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-black/[0.04] last:border-none">
                <Link href={n.href} onClick={() => setOpen(false)} className="block py-3.5 text-[17px] font-medium">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" data-ask-entry onClick={() => { setOpen(false); openCommandBar(); }} className="block w-full py-3.5 text-left text-[17px] font-medium text-accent">
                Ask Kubera AI
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </header>
  );
}

/** Disclosure menu (button + list of links) for the financing pages in the desktop bar. */
function FinancingMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-ink"
      >
        Financing
        <svg viewBox="0 0 12 12" className={`size-2.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul
        id={panelId}
        hidden={!open}
        className="absolute left-1/2 top-full z-50 mt-3 min-w-[184px] -translate-x-1/2 rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-float"
      >
        {FINANCING_MENU.map((n) => (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={() => setOpen(false)}
              className="block whitespace-nowrap rounded-xl px-3 py-2 text-[13px] text-ink/80 transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SparkIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Zm5 10c.2 1.8 1 2.6 2.8 2.8-1.8.2-2.6 1-2.8 2.8-.2-1.8-1-2.6-2.8-2.8 1.8-.2 2.6-1 2.8-2.8Z" />
    </svg>
  );
}
