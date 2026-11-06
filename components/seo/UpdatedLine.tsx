import { contentUpdated, formatContentDate } from "@/lib/seo/content-dates";

/**
 * "Updated November 5, 2026" under a page's lead answer: the same date the
 * sitemap gives as <lastmod> (lib/seo/content-dates.ts). Renders nothing for a
 * path whose content date is not tracked.
 */
export function UpdatedLine({ path, className = "mt-4" }: { path: string; className?: string }) {
  const iso = contentUpdated(path);
  if (!iso) return null;
  return (
    <p className={`${className} text-[14px] text-ink/70`}>
      Updated <time dateTime={iso}>{formatContentDate(iso)}</time>
    </p>
  );
}
