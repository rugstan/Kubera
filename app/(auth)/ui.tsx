import { PendingButton } from "./pending-button";

// Small presentational pieces shared by the sign-in pages.

export function AuthCard({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bento p-7 sm:p-8" aria-labelledby="auth-title">
      <h1 id="auth-title" className="font-display text-[28px] font-semibold tracking-tight text-ink">
        {title}
      </h1>
      {intro ? <p className="mt-2 text-[15px] leading-relaxed text-titanium">{intro}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mt-4 rounded-xl border px-4 py-3 text-[14px] ${tone === "error" ? "border-red-700/30 bg-red-50 text-red-800" : "badge-emerald"}`}
    >
      {children}
    </p>
  );
}

export function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return <PendingButton disabled={disabled}>{children}</PendingButton>;
}
