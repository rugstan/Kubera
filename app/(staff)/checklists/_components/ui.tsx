// Small presentational pieces shared by the deal desk pages (server components).

import { SignInRedirect } from "@/lib/auth/sign-in-redirect";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function Notice({ ok, error }: { ok?: string; error?: string }) {
  if (error)
    return (
      <p role="alert" className="mb-6 rounded-2xl border border-red-700/40 bg-red-50 px-4 py-3 text-[15px] text-red-900">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="mb-6 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-[15px] text-ink">
        {ok}
      </p>
    );
  return null;
}

const TONE: Record<string, string> = {
  good: "border-accent/40 bg-accent/10 text-accent-hover",
  warn: "border-amber-700/40 bg-amber-50 text-amber-900",
  bad: "border-red-700/40 bg-red-50 text-red-900",
  muted: "border-black/15 bg-black/[0.03] text-ink/80",
};

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

export function Card({ id, title, children, actions }: { id?: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="bento mb-8 scroll-mt-6 p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="text-xl font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Not signed in as staff (or lib/auth is not configured): send the visitor through WS-I sign-in with MFA. */
export function SignIn() {
  return <SignInRedirect to="login" />;
}

export const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);
export const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
