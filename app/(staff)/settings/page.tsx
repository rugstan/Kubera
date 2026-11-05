import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/settings/ai",
    title: "AI models",
    body: "Which model each AI task runs on (mail triage, document extraction, the term-sheet parser and more), its default, its data ceiling and who changed it.",
  },
] as const;

export default function SettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-[32px] font-semibold text-ink">Settings</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">Platform settings. Every change is recorded with who made it and why.</p>
      </div>
      <Suspense fallback={<div className="bento h-40 animate-pulse" aria-label="Loading settings" />}>
        <Sections />
      </Suspense>
    </>
  );
}

async function Sections() {
  const ctx = await requireStaff("/settings");
  const manage = can(ctx.principal, "manage_ai_settings", californiaDate(new Date()));
  return (
    <ul className="grid gap-4 sm:grid-cols-2" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <li key={s.href} className="min-w-0">
          <article className="bento h-full p-6">
            <h2 className="text-[18px] font-semibold text-ink">
              <Link href={s.href} className="underline-offset-2 hover:underline">
                {s.title}
              </Link>
            </h2>
            <p className="mt-1 text-[14px] text-titanium">{s.body}</p>
            {manage.ok ? null : <p className="mt-2 text-[13px] text-titanium">Read-only for you: {manage.reason.charAt(0).toLowerCase() + manage.reason.slice(1)}</p>}
          </article>
        </li>
      ))}
    </ul>
  );
}
