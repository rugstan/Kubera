import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Check, Field, Flash, Loading, NotConfigured, Section, Select, SignInRequired, Submit, Table, money } from "@/app/(staff)/deals/ui";
import { agentSafety } from "@/lib/agents/core/server";
import { DEFAULT_MAX_HOLD_MONTHS, type ComparisonRow } from "@/lib/agents/lenders/all-in";
import { logLenderMatch } from "@/lib/agents/lenders/decision-log";
import { lenderRuntime, savedSpreadsFor } from "@/lib/agents/lenders/runtime";
import { compareDealQuotes, matchDeal } from "@/lib/agents/lenders/service";
import { ASSET_CLASS_LABELS, assetClasses, type Quote } from "@/lib/agents/lenders/types";
import { currentStaff } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { DEAL_PROGRAM_LABELS, type LenderPanelEntry } from "@/lib/deals/types";
import { addQuoteAction, ingestTermSheetsAction, quoteStatusAction, reviewQuoteAction, submitOutreachAction } from "../../actions";
import { FormInputError, METRIC_FIELDS, mergeSavedSpreads, metricsFromSource, withSavedSpreadDefaults } from "../../_lib/forms";
import { QuoteFields } from "../../_components/QuoteFields";

export const metadata: Metadata = { title: "Match lenders" };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MatchPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="lender match" />}>
      <MatchData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const pct = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);

function toParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of METRIC_FIELDS) {
    const v = sp[k];
    if (typeof v === "string" && v.trim()) q.set(k, v.trim().slice(0, 40));
  }
  return q;
}

async function MatchData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired level={1} />;
  const rt = lenderRuntime();
  if (!rt) return <NotConfigured level={1} />;
  if (!UUID.test(id)) notFound();
  const deal = await rt.desk.store.getDeal(id);
  if (!deal) notFound();

  // The latest saved spreads (from the borrower's documents) are the defaults; anything typed overrides them.
  const saved = await savedSpreadsFor(rt, deal);
  const query = withSavedSpreadDefaults(toParams(sp), saved);
  let metrics: ReturnType<typeof metricsFromSource>;
  let metricsError: string | null = null;
  try {
    metrics = metricsFromSource(query, deal.loanAmountCents);
  } catch (err) {
    metricsError = err instanceof FormInputError ? err.message : "Check the deal metrics";
    metrics = metricsFromSource(withSavedSpreadDefaults(new URLSearchParams(), saved), deal.loanAmountCents);
  }
  metrics = { ...metrics, spreads: mergeSavedSpreads(metrics.spreads, saved) };
  const deps = { boxes: rt.store, desk: rt.desk.store, now: rt.desk.now };
  const [{ match }, lenders, quotesView, docs] = await Promise.all([
    matchDeal(deps, deal.id, metrics.overrides),
    rt.desk.store.listLenders(),
    compareDealQuotes({ quotes: rt.store, now: rt.desk.now }, deal.id, { ...(metrics.holdMonths ? { holdMonths: metrics.holdMonths } : {}), ...(metrics.reinvestmentRatePct !== null ? { reinvestmentRatePct: metrics.reinvestmentRatePct } : {}), noiCents: metrics.spreads.noiCents ?? null }, { targetCloseDays: metrics.overrides.targetCloseDays ?? null }),
    deal.leadId ? rt.desk.vaultDocuments(deal.leadId) : Promise.resolve([]),
  ]);
  // Reason-code log of the ranking staff see (skipped when unchanged since the last view).
  await logLenderMatch(agentSafety().events, { dealId: deal.id, match, now: rt.desk.now(), context: "view" });
  const write = can(staff, "write");
  const returnQuery = query.toString();
  const shareRaw = (await cookies()).get("lender_share_urls")?.value;
  let shareUrls: { lender: string; url: string }[] = [];
  try {
    shareUrls = shareRaw ? (JSON.parse(shareRaw) as { lender: string; url: string }[]) : [];
  } catch {
    shareUrls = [];
  }
  const review = quotesView.quotes.filter((q) => q.status === "needs_review");
  const v = (k: (typeof METRIC_FIELDS)[number]) => query.get(k) ?? undefined;
  const p = metrics.overrides;
  const nonce = crypto.randomUUID();

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href="/lenders">
          ← Lender matching
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{deal.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge>{DEAL_PROGRAM_LABELS[deal.program]}</Badge>
          <Badge>{money(p.loanAmountCents ?? deal.loanAmountCents)}</Badge>
          {deal.propertyState ? <Badge>{deal.propertyState}</Badge> : null}
          <Link className="text-sm text-accent underline-offset-2 hover:underline" href={`/deals/${deal.id}`}>
            Open on the deal desk (approvals, submissions, share links)
          </Link>
        </div>
      </div>
      <Flash error={typeof sp.error === "string" ? sp.error : (metricsError ?? undefined)} notice={typeof sp.notice === "string" ? sp.notice : undefined} />
      {shareUrls.length ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          <p className="font-medium">Approved. Send each link to its lender from your mailbox now; they are shown only once. Then mark them sent on the deal desk.</p>
          <ul className="mt-1 space-y-1">
            {shareUrls.map((s) => (
              <li className="break-all font-mono text-xs" key={s.url}>
                {s.lender}: {s.url}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section
        description={`${saved ? `NOI and occupancy default to the saved spreads from the borrower's documents (as of ${saved.asOf}); type a figure to override it.` : "No spreads are saved for this deal yet; enter the borrower's numbers."} Ratios are derived from NOI, value and cost when left blank; untested limits are listed below.`}
        title="Deal metrics"
      >
        <form className="grid gap-4 sm:grid-cols-4" method="get">
          <Field defaultValue={v("loan") ?? (deal.loanAmountCents !== null ? String(deal.loanAmountCents / 100) : undefined)} label="Loan amount (USD)" name="loan" />
          <Field defaultValue={v("state") ?? deal.propertyState} label="State" name="state" placeholder="CA" />
          <Select defaultValue={p.assetClass ?? ""} label="Asset class" name="assetClass" options={[{ value: "", label: "Program default" }, ...assetClasses.map((a) => ({ value: a, label: ASSET_CLASS_LABELS[a] }))]} />
          <Select defaultValue={p.lienPosition ?? "first"} label="Lien" name="lien" options={[{ value: "first", label: "First lien" }, { value: "second", label: "Second lien" }]} />
          <Field defaultValue={v("noi")} label="NOI (USD / yr)" name="noi" />
          <Field defaultValue={v("value")} label="Value (USD)" name="value" />
          <Field defaultValue={v("cost")} label="Total cost (USD)" name="cost" />
          <Field defaultValue={v("occupancy")} label="Occupancy (%)" name="occupancy" />
          <Field defaultValue={v("ltv")} hint={p.ltvPct !== undefined && !v("ltv") ? `Derived: ${p.ltvPct}%` : undefined} label="LTV (%)" name="ltv" />
          <Field defaultValue={v("ltc")} label="LTC (%)" name="ltc" />
          <Field defaultValue={v("dscr")} label="DSCR (x)" name="dscr" />
          <Field defaultValue={v("debtYield")} hint={p.debtYieldPct !== undefined && !v("debtYield") ? `Derived: ${p.debtYieldPct}%` : undefined} label="Debt yield (%)" name="debtYield" />
          <Field defaultValue={v("closeDays")} label="Days to close needed" name="closeDays" />
          <Field defaultValue={v("franchise")} label="Franchise flag" name="franchise" />
          <Field defaultValue={v("hold")} hint={`Quote comparison; default the term up to ${DEFAULT_MAX_HOLD_MONTHS}.`} label="Expected hold (months)" name="hold" />
          <Field defaultValue={v("reinvest")} hint="Yield maintenance / defeasance estimate." label="Reinvestment rate (%)" name="reinvest" />
          <div className="sm:col-span-4 flex flex-wrap items-center gap-4">
            <Check defaultChecked={Boolean(p.requiresNonRecourse)} label="Borrower needs non-recourse" name="nonRecourse" />
            <Submit>Rank lenders</Submit>
          </div>
        </form>
      </Section>

      <Section description="Only approved credit boxes are used. Scores weigh leverage cushion, relationship, verification, speed, size and recourse." title="Ranked lenders">
        {match.untested.length ? <p className="mb-3 text-sm text-amber-900">Not tested (add them above): {match.untested.join(", ")}.</p> : null}
        {match.usedFallback ? (
          <div className="mb-4 rounded-xl bg-black/5 p-3 text-sm">
            <p className="font-medium">No approved credit box covers {DEAL_PROGRAM_LABELS[deal.program]}. Static routing suggests:</p>
            <ul className="mt-1 list-disc pl-5">
              {match.fallback.length ? match.fallback.map((f) => <li key={f.name}>{f.name} — {f.reason}</li>) : <li>No static routing for this program.</li>}
            </ul>
          </div>
        ) : null}
        {write ? (
          <form action={submitOutreachAction} className="space-y-5">
            <input name="dealId" type="hidden" value={deal.id} />
            <input name="returnQuery" type="hidden" value={returnQuery} />
            {[...query.entries()].map(([k, val]) => (
              <input key={k} name={k} type="hidden" value={val} />
            ))}
            <LenderTable candidates={match.ranked.map((c) => ({ lender: c.lender, score: c.score, reasons: c.reasons, warnings: c.warnings, matched: true }))} />
            {match.excluded.length || match.fallback.some((f) => f.lender) ? (
              <details className="rounded-xl border border-black/10 p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium">Excluded and fallback lenders (submit only with an override reason)</summary>
                <div className="mt-3">
                  <LenderTable
                    candidates={[
                      ...match.excluded.flatMap((e) => (e.lender ? [{ lender: e.lender, score: null, reasons: [], warnings: e.failures, matched: false }] : [])),
                      ...match.fallback.flatMap((f) => (f.lender ? [{ lender: f.lender, score: null, reasons: [f.reason], warnings: [], matched: false }] : [])),
                    ]}
                  />
                </div>
              </details>
            ) : null}
            <fieldset>
              <legend className="field-label">Vault documents (malware-scanned)</legend>
              {docs.length ? (
                <div className="grid gap-1 sm:grid-cols-2">
                  {docs.map((d) => (
                    <label className="flex min-h-11 items-center gap-2 text-sm" key={d.id}>
                      <input className="size-4 accent-[var(--color-accent)]" name="documentId" type="checkbox" value={d.id} /> {d.fileName} <span className="text-titanium">({d.kind})</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-titanium">{deal.leadId ? "No clean documents in the vault yet." : "Link the deal to its lead on the deal desk to include vault documents."}</p>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Check defaultChecked label="Include the executive summary PDF (deal + metrics above)" name="includeSummary" />
              <Link className="text-sm text-accent underline-offset-2 hover:underline" href={`/lenders/deals/${deal.id}/package${returnQuery ? `?${returnQuery}` : ""}`} prefetch={false}>
                Preview the summary PDF
              </Link>
              <label className="block">
                <span className="field-label">Highlights (one per line)</span>
                <textarea className="field min-h-24" name="highlights" />
              </label>
              <label className="block">
                <span className="field-label">Risks and mitigants (one per line)</span>
                <textarea className="field min-h-24" name="risks" />
              </label>
              <Field label="Use of proceeds" name="purpose" placeholder="Refinance bridge debt into HUD 232/223(f)" />
              <Field label="Note to the approving broker" name="note" />
              <Field hint="Required for a lender the matcher did not rank." label="Override reason" name="overrideReason" />
              <Check label="Acknowledge stale lender verification" name="allowStale" />
            </div>
            <Submit>Request approval to submit</Submit>
            <p className="text-xs text-titanium">Each submission waits for broker approval. Nothing is sent, and no share link exists, until a broker approves it.</p>
          </form>
        ) : (
          <LenderTable candidates={match.ranked.map((c) => ({ lender: c.lender, score: c.score, reasons: c.reasons, warnings: c.warnings, matched: true }))} readOnly />
        )}
      </Section>

      <Section description={`Priced over a ${metrics.holdMonths ?? `term (≤ ${DEFAULT_MAX_HOLD_MONTHS}-month)`} hold, including fees, MIP, reserves, prepayment and exit costs.`} title="Quotes">
        {write ? (
          <form action={ingestTermSheetsAction} className="mb-4">
            <input name="dealId" type="hidden" value={deal.id} />
            <input name="returnQuery" type="hidden" value={returnQuery} />
            <Submit tone="glass">Read term sheets from lenders@</Submit>
          </form>
        ) : null}
        <Comparison rows={quotesView.rows} write={write} dealId={deal.id} returnQuery={returnQuery} />
      </Section>

      {review.length ? (
        <Section description="Parsed with low confidence or from an unknown sender. Confirm or correct every term before the quote is compared." title={`Review queue (${review.length})`}>
          <div className="space-y-6">
            {review.map((q) => (
              <ReviewForm dealId={deal.id} key={q.id} lenders={lenders} quote={q} returnQuery={returnQuery} write={write} />
            ))}
          </div>
        </Section>
      ) : null}

      {write ? (
        <Section description="A quote received by phone or in a format the parser cannot read." title="Add a quote">
          <form action={addQuoteAction} className="space-y-4">
            <input name="dealId" type="hidden" value={deal.id} />
            <input name="returnQuery" type="hidden" value={returnQuery} />
            <input name="nonce" type="hidden" value={nonce} />
            <QuoteFields idPrefix="new" lenderId={null} lenders={lenders} terms={null} />
            <Submit>Add quote</Submit>
          </form>
        </Section>
      ) : null}
    </>
  );
}

type CandidateRow = { lender: LenderPanelEntry; score: number | null; reasons: string[]; warnings: string[]; matched: boolean };

function LenderTable({ candidates, readOnly }: { candidates: CandidateRow[]; readOnly?: boolean }) {
  return (
    <Table
      empty="No lender's approved credit box fits this deal."
      head={readOnly ? ["Lender", "Score", "Why", "Watch"] : ["Submit", "Lender", "Score", "Why", "Watch"]}
      rows={candidates.map((c) => [
        ...(readOnly
          ? []
          : [
              <label className="flex min-h-11 items-center" key="c">
                <input aria-label={`Submit to ${c.lender.name}`} className="size-4 accent-[var(--color-accent)]" name="lenderId" type="checkbox" value={c.lender.id} />
              </label>,
            ]),
        <span className="font-medium" key="n">
          {c.lender.name}
        </span>,
        c.score === null ? "—" : <Badge key="s" tone={c.score >= 75 ? "good" : c.score >= 55 ? "neutral" : "warn"}>{c.score}</Badge>,
        <ul className="list-disc pl-4 text-xs" key="r">
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>,
        <ul className={`list-disc pl-4 text-xs ${c.matched ? "text-amber-900" : "text-red-900"}`} key="w">
          {c.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>,
      ])}
    />
  );
}

function QuoteStatusButton({ quoteId, to, label, dealId, returnQuery }: { quoteId: string; to: string; label: string; dealId: string; returnQuery: string }) {
  return (
    <form action={quoteStatusAction}>
      <input name="dealId" type="hidden" value={dealId} />
      <input name="returnQuery" type="hidden" value={returnQuery} />
      <input name="quoteId" type="hidden" value={quoteId} />
      <input name="to" type="hidden" value={to} />
      <Submit tone="glass">{label}</Submit>
    </form>
  );
}

function Comparison({ rows, write, dealId, returnQuery }: { rows: ComparisonRow[]; write: boolean; dealId: string; returnQuery: string }) {
  return (
    <Table
      empty="No reviewed quotes yet."
      head={["#", "Lender", "All-in", "Note rate", "Net proceeds", "Upfront costs", "Annual debt service", "Prepay + exit", "Recourse", "Binding", "Close", "Notes", ""]}
      rows={rows.map((r) => [
        r.rank ?? "—",
        <span key="l">
          <span className="font-medium">{r.lenderName}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {r.badges.map((b) => (
              <Badge key={b} tone="good">
                {b}
              </Badge>
            ))}
          </span>
        </span>,
        r.allIn ? <strong key="a">{pct(r.allIn.allInRatePct)}</strong> : <span key="e">{r.error}</span>,
        `${pct(r.terms.ratePct)}${r.terms.rateType === "floating" ? " float" : ""}`,
        money(r.allIn?.netProceedsCents),
        money(r.allIn?.upfrontCostsCents),
        money(r.allIn?.stabilizedAnnualDebtServiceCents),
        money(r.allIn ? r.allIn.prepayCostCents + r.allIn.exitFeeCents : null),
        r.terms.recourse?.replace("_", "-") ?? "—",
        r.terms.bindingConstraint?.replace("_", " ") ?? "—",
        r.terms.timelineDays ? `${r.terms.timelineDays} days` : "—",
        <ul className="list-disc pl-4 text-xs" key="f">
          {[...r.flags, ...(r.allIn?.warnings ?? [])].map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>,
        write ? (
          <div className="flex flex-wrap gap-2" key="x">
            <QuoteStatusButton dealId={dealId} label="Borrower accepted" quoteId={r.id} returnQuery={returnQuery} to="accepted" />
            <QuoteStatusButton dealId={dealId} label="Declined" quoteId={r.id} returnQuery={returnQuery} to="declined" />
            <QuoteStatusButton dealId={dealId} label="Withdrawn" quoteId={r.id} returnQuery={returnQuery} to="withdrawn" />
          </div>
        ) : null,
      ])}
    />
  );
}

function ReviewForm({ quote, lenders, dealId, returnQuery, write }: { quote: Quote; lenders: LenderPanelEntry[]; dealId: string; returnQuery: string; write: boolean }) {
  const flagged = quote.lowConfidenceFields;
  return (
    <div className="rounded-xl border border-black/10 p-4">
      <p className="font-medium text-ink">
        {quote.lenderName} <span className="text-sm font-normal text-titanium">· received {quote.receivedAt.slice(0, 10)} · parsed by {quote.parser}</span>
      </p>
      <p className="mt-1 text-sm text-amber-900">Check: {flagged.join(", ") || "all terms"}.</p>
      {quote.reviewNote ? <p className="mt-1 text-xs text-titanium">{quote.reviewNote}</p> : null}
      {write ? (
        <div className="mt-3 space-y-3">
          <form action={reviewQuoteAction} className="space-y-3">
            <input name="dealId" type="hidden" value={dealId} />
            <input name="returnQuery" type="hidden" value={returnQuery} />
            <input name="quoteId" type="hidden" value={quote.id} />
            <QuoteFields flagged={flagged} idPrefix={`q-${quote.id}`} lenderId={quote.lenderId} lenders={lenders} terms={quote.allIn || quote.terms.termMonths ? quote.terms : null} />
            <Field label="Review note" name="reviewNote" />
            <Submit>Confirm terms</Submit>
          </form>
          <QuoteStatusButton dealId={dealId} label="Not a quote — decline" quoteId={quote.id} returnQuery={returnQuery} to="declined" />
        </div>
      ) : null}
    </div>
  );
}
