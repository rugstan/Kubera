import { NextResponse, type NextRequest } from "next/server";
import { NOINDEX_HEADER, expressAction, isExpressHost, isPreviewDeployment } from "@/lib/seo/hosts";
import { isUnknownSlugPath } from "@/lib/seo/known-slugs";
import { site } from "@/lib/site";

/** No route matches this path, so rewriting to it renders the branded 404 with status 404. */
const UNMATCHED_PATH = "/__not-found";

// Next 16 renamed middleware.ts to proxy.ts; behavior is identical.
//
// Traffic on the short express domain (kubera.loans) only ever sees the
// distraction-free qualifier at `/`. Its API calls and static assets pass
// through so the funnel works on its own origin, `/express` 308s to `/`, there
// is no sitemap, and every response carries `X-Robots-Tag: noindex` so the main
// site stays the only indexed copy. Preview deployments are noindex too.
// The routing decisions live in `lib/seo/hosts.ts` where they are unit-tested.

function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", NOINDEX_HEADER);
  return res;
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const preview = isPreviewDeployment();

  if (!isExpressHost(host)) {
    // Unknown slugs on the dynamic public routes answer 404 before rendering;
    // otherwise cacheComponents streams the shell first and the response is a
    // 200 soft 404 that also creates a cache entry per random slug. Rewriting
    // to a path no route matches gives the branded not-found page with a real 404.
    if (isUnknownSlugPath(req.nextUrl.pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = UNMATCHED_PATH;
      url.search = "";
      return noindex(NextResponse.rewrite(url));
    }
    return preview ? noindex(NextResponse.next()) : NextResponse.next();
  }

  const action = expressAction(req.nextUrl.pathname);
  switch (action.type) {
    case "rewrite": {
      const url = req.nextUrl.clone();
      url.pathname = action.pathname;
      return noindex(NextResponse.rewrite(url));
    }
    case "redirect": {
      const target = action.mainSite
        ? new URL(action.pathname + req.nextUrl.search, site.siteUrl)
        : Object.assign(req.nextUrl.clone(), { pathname: action.pathname });
      return noindex(NextResponse.redirect(target, action.status));
    }
    case "notFound":
      return noindex(new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    default:
      return noindex(NextResponse.next());
  }
}

// robots.txt is excluded so crawlers always read it unmodified; sitemap.xml is
// included so the express host can answer 404 for it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt).*)"],
};
