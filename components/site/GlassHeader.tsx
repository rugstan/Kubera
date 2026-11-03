"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Logo } from "./Logo";
import {
  ALL_FINANCING,
  FINANCING_FAMILIES,
  HEADER_CTA,
  POPULAR_PROGRAMS,
  PRIMARY_LINKS,
  SIZER_LINK,
  type NavLink,
} from "./nav";

// Text links in the bar are plain ink at 12px, like apple.com: no underline, no
// active color, and no blue or titanium text. Only the filled CTA is colored.
// The display class is added per use: `hidden` and `inline-flex` on one element would depend on CSS order.
const BAR_TEXT =
  "min-h-8 items-center whitespace-nowrap text-[12px] font-normal tracking-[-0.01em] text-ink/80 transition-colors hover:text-ink";

// Below this width the open menu is a stacked list; from it the bar shows the links.
const DESKTOP_MIN = 1024;

/** The flyout's Get started column. `call` is "Book a call", or "Email an advisor" until scheduling is set up. */
const getStarted = (call: NavLink): NavLink[] => [
  { href: HEADER_CTA.href, label: HEADER_CTA.label },
  SIZER_LINK,
  call,
  { href: "/rates", label: "Today's rates" },
];

export function GlassHeader({ phone, telHref, call }: { phone?: string | null; telHref?: string | null; call: NavLink }) {
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // Space left under the bar. The rate ticker sits above the sticky header
  // until the page scrolls, so this is measured rather than assumed to be
  // 100dvh minus the bar; the CSS max-height is the first-frame fallback.
  const [panelMax, setPanelMax] = useState<number | null>(null);

  // Menu links close the menus when clicked; browser back and forward change the
  // page without one, so they close both too (an open flyout's scrim would
  // otherwise stay over the next page).
  useEffect(() => {
    const onHistory = () => {
      setFlyout(false);
      setOpen(false);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = Math.max(0, navRef.current?.getBoundingClientRect().bottom ?? 0);
        // Less 1px for the header's bottom border.
        setPanelMax(Math.max(0, Math.floor(window.innerHeight - bottom) - 1));
      });
    };
    const onResize = () => {
      // The menu button is hidden from the desktop breakpoint, so a menu left
      // open by a rotation or window resize would be unreachable.
      if (window.innerWidth >= DESKTOP_MIN) setOpen(false);
      else measure();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-black/[0.08]">
        <nav
          ref={navRef}
          className="mx-auto flex h-12 max-w-[1024px] items-center justify-between gap-2 px-4 sm:gap-4 md:h-11 md:px-[22px]"
          aria-label="Primary"
        >
          <Link href="/" className="flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap" aria-label="Corin Commercial home">
            <Logo compact />
          </Link>
          <ul className="hidden items-center gap-6 lg:flex xl:gap-8">
            <li>
              <FinancingMenu open={flyout} onOpenChange={setFlyout} call={call} />
            </li>
            {PRIMARY_LINKS.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={`${BAR_TEXT} inline-flex`}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          {/* Gaps are tight on phones: the toggle already has 12px of padding around its lines, and a 390px bar must hold the full wordmark, the CTA and the toggle. */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-4">
            {telHref ? (
              <a href={`tel:${telHref}`} data-header-phone className={`${BAR_TEXT} hidden xl:inline-flex`}>
                {phone || telHref}
              </a>
            ) : null}
            <Link href={SIZER_LINK.href} data-header-cta="sizer" className={`${BAR_TEXT} hidden sm:inline-flex`}>
              {SIZER_LINK.label}
            </Link>
            {/* Two spans rather than an aria-label, so the accessible name is always the visible text (WCAG 2.5.3). */}
            <Link href={HEADER_CTA.href} data-header-cta="primary" className="pill pill-primary pill-sm max-md:min-h-9">
              <span className="min-[360px]:hidden">{HEADER_CTA.shortLabel}</span>
              <span className="hidden min-[360px]:inline">{HEADER_CTA.label}</span>
            </Link>
            <button
              ref={toggleRef}
              type="button"
              className="grid size-10 place-items-center rounded-full lg:hidden"
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
        {open && (
          // Opens with one short opacity/transform animation (.menu-drop). The
          // inner box caps the panel at the space under the bar and scrolls, so
          // every link stays reachable on short viewports and at high zoom
          // (WCAG 1.4.10, 2.4.11).
          <div className="menu-drop lg:hidden">
            <div
              data-mobile-nav-scroll
              style={panelMax === null ? undefined : { maxHeight: panelMax }}
              className="max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain border-t border-black/[0.08] bg-[rgb(250_250_252)]"
            >
              <MobileMenu phone={phone} telHref={telHref} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}
      </header>
      {/*
        The scrim is a sibling of the header, not a child: the header's
        backdrop-filter would make a fixed child cover only the header box.
        z-30 sits under the header (z-40, which holds the panel) and over the page.
      */}
      {flyout && (
        // A plain tint, no backdrop blur: blurring the whole viewport (with the
        // rate ticker moving underneath) repainted the page on every frame.
        <div
          aria-hidden
          data-nav-scrim
          onClick={() => setFlyout(false)}
          className="menu-fade fixed inset-0 z-30 bg-[rgb(232_232_237/0.7)]"
        />
      )}
    </>
  );
}

function MobileMenu({ phone, telHref, onNavigate }: { phone?: string | null; telHref?: string | null; onNavigate: () => void }) {
  const big = "block py-2 text-[28px] font-semibold leading-[1.14] text-ink";
  return (
    <div id="mobile-nav" className="px-4 pb-6 pt-3">
      <ul>
        <li>
          <Link href="/financing" onClick={onNavigate} className={big}>
            Financing
          </Link>
          <ul className="pb-2 pl-4">
            {FINANCING_FAMILIES.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={onNavigate} className="flex min-h-11 items-center text-[17px] text-ink/80">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </li>
        {PRIMARY_LINKS.map((n) => (
          <li key={n.href}>
            <Link href={n.href} onClick={onNavigate} className={big}>
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-3">
        <Link href={HEADER_CTA.href} onClick={onNavigate} className="pill pill-primary w-full">
          {HEADER_CTA.label}
        </Link>
        <Link href={SIZER_LINK.href} onClick={onNavigate} className="pill pill-secondary w-full">
          {SIZER_LINK.label}
        </Link>
        {telHref ? (
          <a href={`tel:${telHref}`} className="flex min-h-11 items-center justify-center text-[17px] text-ink/80">
            Call {phone || telHref}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Apple-style flyout for the Financing pages: a full-width panel under the bar.
 * It is a disclosure (button + panel), not an ARIA menu, so Tab walks every
 * link. The panel stays in the DOM with `hidden` while closed.
 */
function FinancingMenu({ open, onOpenChange, call }: { open: boolean; onOpenChange: (open: boolean) => void; call: NavLink }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Space left under the header, measured like the mobile panel: the rate
  // ticker sits above the sticky header until the page scrolls, so the CSS
  // max-height (100dvh less the bar) is only the first-frame fallback.
  const [panelMax, setPanelMax] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = Math.max(0, rootRef.current?.closest("header")?.getBoundingClientRect().bottom ?? 0);
        setPanelMax(Math.max(0, Math.floor(window.innerHeight - bottom)));
      });
    };
    const onResize = () => {
      // The bar's links (and this trigger) are hidden below the desktop
      // breakpoint, so a flyout left open by a resize would leave its scrim
      // over the page with no visible way to close it.
      if (window.innerWidth < DESKTOP_MIN) onOpenChange(false);
      else measure();
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", onResize);
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const close = () => onOpenChange(false);
  const typesId = `${panelId}-types`;
  const popularId = `${panelId}-popular`;
  const startId = `${panelId}-start`;

  return (
    <div
      ref={rootRef}
      onBlur={(e) => {
        // Focus moved to another control outside the menu. A null target (a click on
        // empty panel space, or the window losing focus) is left to the pointer handler.
        const next = e.relatedTarget as Node | null;
        if (next && !rootRef.current?.contains(next)) close();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={`${BAR_TEXT} inline-flex gap-1`}
      >
        Financing
        <svg viewBox="0 0 12 12" className={`size-2.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Positioned against the sticky header, so the panel spans the full viewport width. */}
      <div id={panelId} hidden={!open} className="absolute inset-x-0 top-full">
        {open && (
          <div
            style={panelMax === null ? undefined : { maxHeight: panelMax }}
            className="menu-drop max-h-[calc(100dvh-3rem)] overflow-y-auto border-b border-black/[0.08] bg-[rgb(250_250_252)]"
          >
            <div className="mx-auto grid max-w-[1024px] gap-10 px-[22px] py-10 md:grid-cols-[1.4fr_1fr_1fr]">
              <FlyoutColumn
                id={typesId}
                heading={"What you're financing"}
                links={[...FINANCING_FAMILIES, ALL_FINANCING]}
                large
                onNavigate={close}
              />
              <FlyoutColumn id={popularId} heading="Popular programs" links={POPULAR_PROGRAMS} onNavigate={close} />
              <FlyoutColumn id={startId} heading="Get started" links={getStarted(call)} onNavigate={close} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FlyoutColumn({
  id,
  heading,
  links,
  large = false,
  onNavigate,
}: {
  id: string;
  heading: string;
  links: NavLink[];
  large?: boolean;
  onNavigate: () => void;
}) {
  return (
    <div>
      <h2 id={id} className="text-[12px] text-graphite">
        {heading}
      </h2>
      <ul aria-labelledby={id} className={large ? "mt-4 space-y-3" : "mt-4 space-y-2"}>
        {links.map((l) => (
          <li key={`${l.href}-${l.label}`}>
            <Link
              href={l.href}
              onClick={onNavigate}
              className={
                large
                  ? "inline-block text-[24px] font-semibold leading-[1.17] text-ink hover:underline"
                  : "inline-block text-[12px] font-semibold text-ink/80 hover:text-ink"
              }
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
