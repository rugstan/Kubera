import Image from "next/image";
import logo from "@/assets/brand/corin-logo.png";
import mark from "@/assets/brand/corin-mark.png";

/** Width over height of the full logo (C mark, divider, CORIN / COMMERCIAL). */
export const LOGO_ASPECT = logo.width / logo.height;

/** Tallest the logo is drawn anywhere (CSS px); next/image serves 1x and 2x of this. */
const MAX_HEIGHT = 40;

/**
 * The Corin Commercial logo: the owner's artwork in assets/brand/ (transparent
 * PNG, cropped to the artwork). Size it with a height class (`h-8`); the width
 * follows the aspect ratio. `compact` swaps to the C mark alone below 360px so
 * the primary header row still fits at 320px (WCAG 1.4.10 Reflow); the hidden
 * image is display:none, so the accessible name is never read twice.
 */
export function Logo({ className = "h-8", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className="flex items-center">
      <Image
        src={logo}
        alt="Corin Commercial"
        width={Math.round(MAX_HEIGHT * LOGO_ASPECT)}
        height={MAX_HEIGHT}
        loading="eager"
        className={`w-auto ${className}${compact ? " max-[359px]:hidden" : ""}`}
      />
      {compact ? <Image src={mark} alt="Corin Commercial" width={MAX_HEIGHT} height={MAX_HEIGHT} loading="eager" className={`hidden w-auto max-[359px]:block ${className}`} /> : null}
    </span>
  );
}
