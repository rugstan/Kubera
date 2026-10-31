import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed middleware.ts to proxy.ts; behavior is identical.
//
// Traffic on the short express domain (kubera.loans) only ever sees the
// distraction-free qualifier. Its API calls and static assets pass through so
// the funnel works on its own origin.
const EXPRESS_HOSTS = new Set(
  (process.env.EXPRESS_HOSTS ?? "kubera.loans,www.kubera.loans").split(",").map((h) => h.trim().toLowerCase()),
);

export function proxy(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  if (!EXPRESS_HOSTS.has(host)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname === "/express") return NextResponse.next();
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/express";
    return NextResponse.rewrite(url);
  }
  // Anything else on the express domain belongs on the main site.
  const target = new URL(pathname + req.nextUrl.search, process.env.NEXT_PUBLIC_SITE_URL ?? "https://kuberacommercial.com");
  return NextResponse.redirect(target, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml).*)"],
};
