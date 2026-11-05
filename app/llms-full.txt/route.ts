import { buildLlmsFullTxt } from "@/lib/seo/llms";

// Full text of the key pages for answer engines; /llms.txt links here.
export function GET() {
  return new Response(buildLlmsFullTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
