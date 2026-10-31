import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { ITEM_STATUS_LABEL, PROGRAM_LABEL, type DealChecklistItem } from "@/lib/checklists/types";
import { site } from "@/lib/site";
import { UploadButton } from "./_components/UploadButton";
import { isContext, portalContext } from "./_lib/session";

export const metadata: Metadata = { title: "Your documents" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Items captured by filling in the profile rather than by uploading a file. */
const PROFILE_ITEMS = new Set(["pfs", "reo_schedule", "credit_authorization", "form_1919", "hud_2530"]);

export default function PortalHome({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-[15px] text-ink/80">Loading your portal…</p>}>
      <PortalContent searchParams={searchParams} />
    </Suspense>
  );
}

function SignedOut({ state }: { state?: string }) {
  return (
    <>
      <h1 className="text-3xl font-semibold sm:text-4xl">Borrower portal</h1>
      {state === "signed_out" ? (
        <p role="status" className="mt-6 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-[15px]">
          You are signed out.
        </p>
      ) : null}
      {state === "unavailable" ? (
        <p role="alert" className="mt-6 rounded-2xl border border-amber-700/40 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          The portal is not available right now. Email your documents to your advisor or to docs@kuberacommercial.com.
        </p>
      ) : null}
      <div className="bento mt-8 p-7">
        <h2 className="text-xl font-semibold">Sign in with your secure link</h2>
        <p className="mt-3 text-[15px] text-ink/80">Your advisor sends each principal a private, single-use link by email. Open it on this device to see the documents we need and to upload them securely. If your link expired, ask your advisor for a new one.</p>
        <p className="mt-4 text-[15px]">
          Need help? Email{" "}
          <a href={`mailto:${site.email}`} className="font-medium text-accent underline underline-offset-2">
            {site.email}
          </a>
          .
        </p>
      </div>
    </>
  );
}

async function PortalContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const state = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const ctx = await portalContext();
  if (!isContext(ctx)) return <SignedOut state={ctx.reason === "unconfigured" ? "unavailable" : state} />;

  const { session, services } = ctx;
  const [checklists, all, principal] = await Promise.all([
    services.checklists.checklistsForDeal(session.dealId),
    services.checklists.itemsForDeal(session.dealId),
    session.principalId ? services.principals.get(session.principalId) : Promise.resolve(null),
  ]);
  const mine = all.filter((i) => i.responsible === "borrower" && i.status !== "not_applicable" && (!session.principalId || !i.principalId || i.principalId === session.principalId));
  const todo = mine.filter((i) => i.status === "requested" || i.status === "rejected");
  const withAdvisor = mine.filter((i) => i.status === "submitted" || i.status === "under_review");
  const done = mine.filter((i) => i.status === "accepted" || i.status === "waived");
  const required = mine.filter((i) => i.required);
  const requiredDone = required.filter((i) => i.status === "accepted" || i.status === "waived").length;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{checklists.map((c) => PROGRAM_LABEL[c.program]).join(" · ") || "Your loan request"}</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{principal ? `Welcome, ${principal.legalName.split(" ")[0]}` : "Your documents"}</h1>
          <p className="mt-2 text-[15px] text-ink/80">
            Signed in as {session.email}. {required.length ? `${requiredDone} of ${required.length} required items are complete.` : ""}
          </p>
        </div>
        <form method="post" action="/portal/sign-out">
          <button type="submit" className="pill pill-glass !px-4 !py-2 !text-[15px]">
            Sign out
          </button>
        </form>
      </div>

      {principal?.kind === "individual" ? (
        <div className="bento mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-lg font-semibold">Your profile</h2>
            <p className="mt-1 text-[15px] text-ink/80">Personal financial statement, real estate owned, identity details and the credit authorization.</p>
          </div>
          <Link href="/portal/profile" className="pill pill-primary !py-2 !text-[15px]">
            Complete your profile
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="todo-title" className="mt-10">
        <h2 id="todo-title" className="text-2xl font-semibold">
          To do ({todo.length})
        </h2>
        {todo.length === 0 ? <p className="mt-3 text-[15px] text-ink/80">Nothing outstanding right now. Your advisor will let you know if anything else is needed.</p> : null}
        <NoticeAtCollection point="upload" className="mt-4" />
        <ul className="mt-4 grid gap-4">
          {todo.map((i) => (
            <TodoItem key={i.id} item={i} />
          ))}
        </ul>
      </section>

      <ItemList id="review" title={`With your advisor (${withAdvisor.length})`} items={withAdvisor} />
      <ItemList id="done" title={`Done (${done.length})`} items={done} />
      <p className="mt-10 text-[13px] text-ink/80">Third-party reports (appraisal, environmental, title) are ordered by the lender of record or vendors and are not listed here.</p>
    </>
  );
}

function TodoItem({ item }: { item: DealChecklistItem }) {
  const viaProfile = PROFILE_ITEMS.has(item.templateKey);
  return (
    <li className="bento p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h3 className="text-[17px] font-semibold">
            {item.title}
            {item.required ? null : <span className="ml-2 text-[13px] font-normal text-ink/80">(optional)</span>}
          </h3>
          <p className="mt-1 text-[15px] text-ink/80">{item.description}</p>
          {item.status === "rejected" && item.reviewNote ? (
            <p className="mt-2 text-[15px] text-red-900">
              <span className="font-semibold">Your advisor asked for a change:</span> {item.reviewNote}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2">
          {viaProfile ? (
            <Link href="/portal/profile" className="pill pill-glass !px-4 !py-2 !text-[15px]">
              Complete in profile<span className="sr-only">: {item.title}</span>
            </Link>
          ) : null}
          {item.upload ? <UploadButton itemId={item.id} itemTitle={item.title} /> : null}
        </div>
      </div>
    </li>
  );
}

function ItemList({ id, title, items }: { id: string; title: string; items: DealChecklistItem[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="mt-10">
      <h2 id={`${id}-title`} className="text-2xl font-semibold">
        {title}
      </h2>
      <ul className="mt-4 divide-y divide-black/10 rounded-2xl border border-black/10 bg-surface">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[15px]">
            <span>{i.title}</span>
            <span className="text-[13px] font-semibold text-ink/80">{ITEM_STATUS_LABEL[i.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
