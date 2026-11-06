import type { SitemapRoute } from "@/lib/seo/sitemap-routes";

export const NEWSLETTER_PATH = "/newsletter";

export const NEWSLETTER_PAGE = {
  title: "Commercial real estate debt newsletter",
  description: "A monthly email from Corin Commercial with market notes, HUD, SBA and CMBS program updates and new tools. Double opt-in; unsubscribe any time.",
  lead: "A short monthly email from a licensed California loan broker: what moved in HUD, SBA, CMBS and bridge financing, the numbers behind it, and new tools on the site.",
  promises: [
    "About one email a month, sent from our news address.",
    "Education and program updates, not loan offers or rate quotes.",
    "You confirm your address by clicking a link before anything is sent.",
    "Every email has an unsubscribe link, and we record the choice you make.",
  ],
} as const;

export const newsletterRoutes: SitemapRoute[] = [
  { path: NEWSLETTER_PATH, title: NEWSLETTER_PAGE.title, description: NEWSLETTER_PAGE.description, changeFrequency: "yearly", priority: 0.4, section: "Resources" },
];
