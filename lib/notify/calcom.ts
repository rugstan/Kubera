// Cal.com booking link helper. The handle comes from NEXT_PUBLIC_CALCOM_LINK
// (the same variable the /contact embed uses), either "team/intro" or a full
// https://cal.com/team/intro URL. Unset means no link: callers fall back to
// the contact email.

export type BookingPrefill = {
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  /** Attribution tag, e.g. "lead-confirmation". Becomes utm_source=kubera, utm_campaign=<tag>. */
  campaign?: string | null;
};

const HANDLE = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,120}$/;

/** Returns the booking base URL for a configured handle, or null when unset or invalid. */
export function calcomBaseUrl(handle: string | undefined | null = process.env.NEXT_PUBLIC_CALCOM_LINK): string | null {
  const raw = handle?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") return null;
      if (u.hostname !== "cal.com" && !u.hostname.endsWith(".cal.com")) return null;
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  }
  const cleaned = raw.replace(/^\/+|\/+$/g, "");
  if (!HANDLE.test(cleaned) || cleaned.includes("..")) return null;
  return `https://cal.com/${cleaned}`;
}

/** Booking URL with optional prefill (Cal.com reads name, email and notes from the query string). */
export function bookingLink(prefill: BookingPrefill = {}, handle?: string | null): string | null {
  const base = calcomBaseUrl(handle === undefined ? process.env.NEXT_PUBLIC_CALCOM_LINK : handle);
  if (!base) return null;
  const url = new URL(base);
  const name = prefill.name?.trim();
  const email = prefill.email?.trim();
  const notes = prefill.notes?.trim();
  if (name) url.searchParams.set("name", name.slice(0, 120));
  if (email) url.searchParams.set("email", email.slice(0, 200));
  if (notes) url.searchParams.set("notes", notes.slice(0, 500));
  if (prefill.campaign) {
    url.searchParams.set("utm_source", "kubera");
    url.searchParams.set("utm_campaign", prefill.campaign.slice(0, 60));
  }
  return url.toString();
}
