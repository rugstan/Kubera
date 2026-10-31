import { dreLookupUrl } from "@/lib/site";

/**
 * A DRE license number with a link to the public DRE lookup. The corporate
 * license is guaranteed by the production build guard in `lib/site.ts`; the
 * fallback text can only appear on preview and development builds.
 */
export function LicenseId({ id, fallback = "License number pending configuration" }: { id: string; fallback?: string }) {
  if (!id) return <>{fallback}</>;
  return (
    <>
      #{id}{" "}
      <a href={dreLookupUrl(id)} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">
        Verify with the DRE<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </>
  );
}
