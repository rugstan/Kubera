// The staff app's top-level routes, in nav order. Pure data with no
// server-only imports, so the (staff) layout, client components and robots.txt
// all read the same list. A new staff desk is added here once;
// lib/auth/staff-routes.test.ts fails if a folder under app/(staff)/ is missing.

export const STAFF_NAV = [
  { href: "/pipeline", label: "Pipeline" },
  { href: "/approvals", label: "Approvals" },
  { href: "/documents", label: "Documents" },
  { href: "/deals", label: "Deal desk" },
  { href: "/checklists", label: "Checklists" },
  { href: "/construction", label: "Construction" },
  { href: "/lenders", label: "Lenders" },
  { href: "/ai-review", label: "AI review" },
  { href: "/reports", label: "Reports" },
  { href: "/prospects", label: "Prospects" },
  { href: "/settings", label: "Settings" },
] as const;

/** Path prefixes served by the staff app (each matches itself and its subpaths). */
export const STAFF_ROUTE_PREFIXES: readonly string[] = STAFF_NAV.map((item) => item.href);
