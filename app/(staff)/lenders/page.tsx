import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LenderFilters } from "@/app/(staff)/deals/lenders/_components/LenderFilters";
import { Badge, Flash, Loading, LoanTypeBadges, NotConfigured, Section, SignInRequired, Submit, Table, money, when } from "@/app/(staff)/deals/ui";
import { boxStaleness } from "@/lib/agents/lenders/credit-box";
import { lenderRuntime } from "@/lib/agents/lenders/runtime";
import type { CreditBox } from "@/lib/agents/lenders/types";
import { loanTypeFacet, matchesTokens, normalizeForSearch, parseLenderListQuery, searchTokens } from "@/lib/deals/lender-list";
import { currentStaff } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { DEAL_PROGRAM_LABELS } from "@/lib/deals/types";
import { importRegistrationsAction, reviewBoxAction } from "./actions";

export const metadata: Metadata = { title: "Credit boxes" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function LendersPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Lender matching</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Credit boxes</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">
          Typed lender appetite from /partners registrations and staff edits. Only approved boxes are used to match deals; a box is reviewed again whenever its terms change.
        </p>
      </div>
      <Suspense fallback={<Loading label="credit boxes" />}>
        <BoxesData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TONE = { approved: "good", pending_review: "warn", rejected: "bad", retired: "neutral" } as const;
const ORDER: CreditBox["status"][] = ["pending_review", "approved", "rejected", "retired"];

function limits(b: CreditBox): string {
  const parts = [
    b.maxLtvPct !== null ? `LTV ≤ ${b.maxLtvPct}%` : null,
    b.maxLtcPct !== null ? `LTC ≤ ${b.maxLtcPct}%` : null,
    b.minDscr !== null ? `DSCR ≥ ${b.minDscr.toFixed(2)}x` : null,
    b.minDebtYieldPct !== null ? `DY ≥ ${b.minDebtYieldPct}%` : null,
    b.recourse ? b.recourse.replace("_", "-") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

async function BoxesData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = lenderRuntime();
  if (!rt) return <NotConfigured />;
  const [boxes, lenders, deals] = await Promise.all([rt.store.listBoxes(), rt.desk.store.listLenders(), rt.desk.store.listDeals({ openOnly: true, limit: 50 })]);
  const names = new Map(lenders.map((l) => [l.id, l.name]));
  const now = rt.desk.now();
  const write = can(staff, "write");
  const sorted = [...boxes].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.label.localeCompare(b.label));
  const pending = boxes.filter((b) => b.status === "pending_review").length;
  // The same loan-type filter as the Lender panel, on each box's linked panel lender (only type, match and q apply here).
  const query = parseLenderListQuery(sp);
  const typesByLender = new Map(lenders.map((l) => [l.id, l.loanTypes]));
  const typesOf = (b: CreditBox) => (b.lenderId ? (typesByLender.get(b.lenderId) ?? []) : []);
  const tokens = searchTokens(query.q);
  const searched = sorted.filter((b) => !tokens.length || matchesTokens(` ${normalizeForSearch(`${b.label} ${b.lenderId ? (names.get(b.lenderId) ?? "") : ""}`)}`, tokens));
  const { matched, counts } = loanTypeFacet(searched, typesOf, query);
  const hiddenUnlinked = query.types.length ? searched.filter((b) => !b.lenderId).length : 0;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  return (
    <>
      <Flash error={one("error")} notice={one("notice")} />
      <Section description="Pick a deal to rank lenders, submit the package for broker approval and compare quotes." title="Match a deal">
        <Table
          empty="No open deals on the deal desk."
          head={["Deal", "Program", "Loan", "State"]}
          rows={deals.map((d) => [
            <Link className="font-medium text-accent underline-offset-2 hover:underline" href={`/lenders/deals/${d.id}`} key="t">
              {d.title}
            </Link>,
            DEAL_PROGRAM_LABELS[d.program],
            money(d.loanAmountCents),
            d.propertyState ?? "—",
          ])}
        />
      </Section>
      <Section description={pending ? `${pending} waiting for review.` : undefined} title="Boxes">
        {write ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <form action={importRegistrationsAction}>
              <Submit tone="glass">Import /partners lender registrations</Submit>
            </form>
            <Link className="pill pill-glass min-h-11" href="/lenders/boxes/new">
              Add a credit box
            </Link>
          </div>
        ) : null}
        <LenderFilters action="/lenders" counts={counts} full={false} query={query} />
        <p aria-live="polite" className="mt-4 text-sm text-titanium">
          Showing {matched.length} of {boxes.length} boxes.
          {hiddenUnlinked ? ` ${hiddenUnlinked} ${hiddenUnlinked === 1 ? "box" : "boxes"} not linked to a panel lender ${hiddenUnlinked === 1 ? "is" : "are"} hidden while a loan type is selected.` : ""}
        </p>
        <div className="mt-4">
          {boxes.length > 0 && matched.length === 0 ? (
            <p className="text-sm text-titanium">
              No credit boxes match these filters.{" "}
              <Link className="text-accent underline" href="/lenders">
                Clear all
              </Link>
            </p>
          ) : (
            <Table
              empty="No credit boxes yet. Import lender registrations or add one."
              head={["Box", "Lender", "Programs", "Size", "Limits", "Verified", ""]}
              rows={matched.map((b) => {
                const s = boxStaleness(b, now);
                return [
                  <span key="l">
                    <Link className="font-medium text-ink underline-offset-2 hover:underline" href={`/lenders/boxes/${b.id}`}>
                      {b.label}
                    </Link>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[b.status]}>{b.status.replace("_", " ")}</Badge>
                      {b.source === "partner_registration" ? <Badge>registration</Badge> : null}
                    </span>
                  </span>,
                  b.lenderId ? (
                    <span className="flex flex-col gap-1" key="lt">
                      <span>{names.get(b.lenderId) ?? "Unknown lender"}</span>
                      <LoanTypeBadges types={typesOf(b)} />
                    </span>
                  ) : (
                    <Badge key="u" tone="warn">
                      Not linked
                    </Badge>
                  ),
                  b.programs.length ? b.programs.map((p) => DEAL_PROGRAM_LABELS[p]).join(", ") : "—",
                  `${money(b.minLoanCents)} – ${money(b.maxLoanCents)}`,
                  limits(b),
                  s.stale ? <Badge key="s" tone="warn">{s.ageDays === null ? "Never" : `${s.ageDays} days ago`}</Badge> : when(b.verifiedAt),
                  write ? (
                    <div className="flex flex-wrap gap-2" key="a">
                      <Link className="pill pill-glass min-h-11" href={`/lenders/boxes/${b.id}`}>
                        Review
                      </Link>
                      {b.status === "approved" ? (
                        <form action={reviewBoxAction}>
                          <input name="boxId" type="hidden" value={b.id} />
                          <input name="recordVersion" type="hidden" value={b.recordVersion} />
                          <input name="op" type="hidden" value="verify" />
                          <Submit tone="glass">Verified today</Submit>
                        </form>
                      ) : null}
                    </div>
                  ) : null,
                ];
              })}
            />
          )}
        </div>
      </Section>
    </>
  );
}
