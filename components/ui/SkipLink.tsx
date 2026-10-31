"use client";

/**
 * First tab stop on every page. Moves focus to the page's <main> landmark so
 * keyboard users bypass the ticker and header. Pages own their own <main>
 * element, so the target is resolved at click time; without JavaScript the
 * link degrades to a plain #main-content anchor.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(e) => {
        const main = document.getElementById("main-content") ?? document.querySelector<HTMLElement>("main");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
    >
      Skip to main content
    </a>
  );
}
