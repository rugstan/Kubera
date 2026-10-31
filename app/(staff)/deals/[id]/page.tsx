import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FEE_ENTRY_LABELS, DEAL_PROGRAM_LABELS, isSbaProgram, type Deal, type FeeEntry, type LenderPanelEntry } from "@/lib/deals/types";
import { FORM159_BLOCKING_FLAGS, type Form159Flag } from "@/lib/deals/form159";
import { canTransitionFee, summarizeLedger } from "@/lib/deals/ledger";
import { panelForDeal } from "@/lib/deals/lenders";
import { currentStaff, dealDeskRuntime, type DealDeskRuntime } from "@/lib/deals/runtime";
import { stageContext } from "@/lib/deals/service";
import { can, type StaffSession } from "@/lib/deals/session";
import { availableEvents, stageLabel, stageTemplate } from "@/lib/deals/stages";
import {
  addFeeAction,
  advanceDealAction,
  createInvoiceAction,
  editDealAction,
  feeStatusAction,
  generateForm159Action,
  invoiceAction,
  modificationAction,
  outreachAction,
  revokeLinkAction,
  sendForm159Action,
  sendPackageAction,
  submitModificationAction,
} from "../actions";
import { Badge, Check, Field, Flash, Loading, NotConfigured, Section, Select, SignInRequired, Submit, Table, money, when } from "../ui";

export const metadata: Metadata = { title: "Deal" };

// Deal ids are unknown at build time and the root layout's command bar reads
// the pathname outside a Suspense boundary, so this staff-only page may block
// on the server instead of shipping a static shell.
export const instant = false;

type Params = Promise<{ id: string }>;
type Search = Promise<{ notice?: string; error?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DealPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="deal" />}>
      <DealData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DealData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured />;
  if (!UUID.test(id)) notFound();
  const deal = await rt.store.getDeal(id);
  if (!deal) notFound();
  const shareUrl = (await cookies()).get("deal_share_url")?.value;
  const write = can(staff, "write");
  const template = stageTemplate(deal.program);

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href="/deals">
          ← All deals
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{deal.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge>{DEAL_PROGRAM_LABELS[deal.program]}</Badge>
          <Badge tone="good">{stageLabel(deal.program, deal.stage)}</Badge>
          {deal.termSheetAcceptedAt ? <Badge tone="warn">Terms locked {when(deal.termSheetAcceptedAt)}</Badge> : null}
          <Badge>{money(deal.loanAmountCents)}</Badge>
        </div>
      </div>
      <Flash error={sp.error} notice={sp.notice} />
      {shareUrl ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          <p className="font-medium">Approved. Send this link to the lender from your mailbox now; it is shown only once.</p>
          <p className="mt-1 break-all font-mono text-xs">{shareUrl}</p>
        </div>
      ) : null}

      <StagePanel deal={deal} rt={rt} write={write} />

      {write ? (
        <Section title="Details">
          <form action={editDealAction} className="grid gap-4 sm:grid-cols-2">
            <input name="dealId" type="hidden" value={deal.id} />
            <input name="version" type="hidden" value={deal.recordVersion} />
            <Field defaultValue={deal.title} label="Title" name="title" required />
            <Field defaultValue={deal.borrowerName} label="Borrower" name="borrowerName" />
            <Field defaultValue={deal.propertyAddress} label="Property address" name="propertyAddress" />
            <Field defaultValue={deal.propertyState} label="State" name="propertyState" />
            <Field
              defaultValue={deal.loanAmountCents !== null ? (deal.loanAmountCents / 100).toFixed(2) : ""}
              hint={deal.termSheetAcceptedAt ? "Locked since term-sheet acceptance; change it through a documented modification." : undefined}
              label="Loan amount (USD)"
              name="loanAmount"
            />
            <Select
              defaultValue={deal.collateralRealProperty === null ? "" : deal.collateralRealProperty ? "real_property" : "business_assets"}
              label="Collateral"
              name="collateral"
              options={[
                { value: "", label: "Not yet known" },
                { value: "real_property", label: "Lien on real property" },
                { value: "business_assets", label: "Business assets only (no real property)" },
              ]}
            />
            <Field defaultValue={deal.engagementAgreementRef} hint="Vault reference of the signed engagement / fee agreement." label="Engagement agreement" name="engagementAgreementRef" />
            <div className="sm:col-span-2">
              <Submit>Save details</Submit>
            </div>
          </form>
        </Section>
      ) : null}

      <OutreachPanel deal={deal} rt={rt} write={write} />
      <LedgerPanel deal={deal} rt={rt} write={write} />
      {isSbaProgram(deal.program) ? <Form159Panel deal={deal} rt={rt} write={write} /> : null}
      <ModificationsPanel deal={deal} rt={rt} staff={staff} />
      <AuditPanel deal={deal} rt={rt} />
      <p className="text-xs text-titanium">Template {template.name}.</p>
    </>
  );
}

// ---------------------------------------------------------------------------

async function StagePanel({ deal, rt, write }: { deal: Deal; rt: DealDeskRuntime; write: boolean }) {
  const ctx = await stageContext({ store: rt.store, disclosures: rt.disclosures, now: rt.now }, deal);
  const events = availableEvents(stageTemplate(deal.program), deal.stage);
  const compliance = ctx.compliance;
  return (
    <Section description="Events advance the deal; each checks the records it needs." title="Stage">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li>Engagement agreement: {ctx.engagementAgreementRef ? <Badge tone="good">On file</Badge> : <Badge tone="warn">Missing</Badge>}</li>
        <li>Locked package sent: {ctx.lockedPackageSent ? <Badge tone="good">Yes</Badge> : <Badge>No</Badge>}</li>
        <li>Term sheet: {ctx.termSheetRef ? <Badge tone="good">{ctx.termSheetRef}</Badge> : <Badge>None</Badge>}</li>
        <li>
          Closing gate:{" "}
          {compliance ? (compliance.gates.closing.allowed ? <Badge tone="good">Clear</Badge> : <Badge tone="bad">Blocked</Badge>) : <Badge tone="warn">Not evaluated</Badge>}
        </li>
        {isSbaProgram(deal.program) ? <li>SBA Form 159: {ctx.form159Satisfied ? <Badge tone="good">Satisfied</Badge> : <Badge tone="warn">Signature needed</Badge>}</li> : null}
      </ul>
      {compliance && !compliance.gates.closing.allowed ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-900">
          {compliance.gates.closing.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {ctx.complianceMissing.length ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-amber-900">
          {ctx.complianceMissing.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {compliance?.flags.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {compliance.flags.map((f) => (
            <Badge key={`${f.code}${f.reason}`} tone={f.code === "held_for_counsel" ? "bad" : "warn"}>
              {f.code.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      ) : null}
      {write && events.length ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {events
              .filter((e) => e.key !== "term_sheet_accepted")
              .map((e) => (
                <form action={advanceDealAction} key={e.key}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="event" type="hidden" value={e.key} />
                  <Submit tone={e.key === "withdraw" || e.key === "mark_lost" ? "glass" : "primary"}>{e.label}</Submit>
                </form>
              ))}
          </div>
          {events.some((e) => e.key === "term_sheet_accepted") ? (
            <form action={advanceDealAction} className="grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-3">
              <input name="dealId" type="hidden" value={deal.id} />
              <input name="event" type="hidden" value="term_sheet_accepted" />
              <p className="text-sm font-medium text-ink sm:col-span-3">Accept the term sheet (locks these terms)</p>
              <Field label="Lender" name="lenderName" required />
              <Field label="Note rate (%)" name="noteRatePct" required step="0.001" type="number" />
              <Field label="Term (months)" name="termMonths" required type="number" />
              <Field label="Amortization (months)" name="amortizationMonths" type="number" />
              <Field label="Interest-only (months)" name="interestOnlyMonths" type="number" />
              <Field label="Broker compensation (USD)" name="brokerCompensation" />
              <Field label="Prepayment" name="prepayment" />
              <Field label="Recourse" name="recourse" />
              <div className="self-end">
                <Submit>Accept and lock terms</Submit>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
      {deal.lockedTerms ? (
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          {Object.entries(deal.lockedTerms).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-titanium">{k}</dt>
              <dd className="text-ink">{k.endsWith("Cents") ? money(Number(v)) : String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Section>
  );
}

async function OutreachPanel({ deal, rt, write }: { deal: Deal; rt: DealDeskRuntime; write: boolean }) {
  const [lenders, outreach, packages, links, documents] = await Promise.all([
    rt.store.listLenders({ activeOnly: true }),
    rt.store.listOutreach(deal.id),
    rt.store.listPackages(deal.id),
    rt.store.listShareLinks(deal.id),
    deal.leadId ? rt.vaultDocuments(deal.leadId) : Promise.resolve([]),
  ]);
  const now = rt.now();
  const matches = panelForDeal(lenders, deal, now);
  const lenderName = (id: string) => lenders.find((l: LenderPanelEntry) => l.id === id)?.name ?? "Lender";
  return (
    <Section description="A send locks the package version; the submission waits for broker approval before any link exists." title="Lender outreach">
      {write ? (
        <form action={sendPackageAction} className="grid gap-4 sm:grid-cols-2">
          <input name="dealId" type="hidden" value={deal.id} />
          <Select
            label="Lender"
            name="lenderId"
            options={matches.length ? matches.map((m) => ({ value: m.lender.id, label: `${m.lender.name}${m.staleness.stale ? " (verification stale)" : ""}` })) : [{ value: "", label: "No panel lender matches this deal" }]}
            required
          />
          <Field defaultValue={14} label="Link lifetime (days, max 30)" name="ttlDays" type="number" />
          <fieldset className="sm:col-span-2">
            <legend className="field-label">Documents</legend>
            {documents.length ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {documents.map((d) => (
                  <label className="flex items-center gap-2 text-sm" key={d.id}>
                    <input defaultChecked name="documentId" type="checkbox" value={d.id} />
                    {d.fileName} <span className="text-xs text-titanium">({d.kind})</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-titanium">{deal.leadId ? "No vault documents for this lead yet." : "Link the deal to its lead to package vault documents."}</p>
            )}
          </fieldset>
          <Field label="Note for the approving broker" name="note" />
          <div className="flex flex-col justify-end gap-2">
            <Check label="I re-checked a stale lender's appetite" name="allowStale" />
          </div>
          <div className="sm:col-span-2">
            <Submit>Lock package and request approval</Submit>
          </div>
        </form>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold text-ink">Submissions</h3>
      <Table
        empty="No submissions yet."
        head={["Lender", "Version", "Status", "Sent", "Actions"]}
        rows={outreach.map((o) => [
          lenderName(o.lenderId),
          `v${o.packageVersion}`,
          <Badge key="s" tone={o.status === "term_sheet" ? "good" : o.status === "declined" || o.status === "rejected" || o.status === "expired" ? "bad" : "neutral"}>
            {o.status.replace(/_/g, " ")}
          </Badge>,
          when(o.sentAt),
          write ? (
            <div className="flex flex-wrap gap-2" key="a">
              {o.status === "approved" ? (
                <form action={outreachAction}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="outreachId" type="hidden" value={o.id} />
                  <input name="op" type="hidden" value="sent" />
                  <Submit tone="glass">Mark sent</Submit>
                </form>
              ) : null}
              {o.status === "sent" ? (
                <form action={outreachAction} className="flex flex-wrap items-end gap-2">
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="outreachId" type="hidden" value={o.id} />
                  <input aria-label="Term sheet vault reference" className="field w-48" name="termSheetRef" placeholder="Term sheet vault ref" />
                  <Submit name="op" tone="glass" value="term_sheet">
                    Term sheet
                  </Submit>
                  <Submit name="op" tone="glass" value="declined">
                    Declined
                  </Submit>
                </form>
              ) : null}
              {!["withdrawn", "rejected", "expired"].includes(o.status) ? (
                <form action={outreachAction}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="outreachId" type="hidden" value={o.id} />
                  <input name="op" type="hidden" value="withdraw" />
                  <Submit tone="glass">Withdraw</Submit>
                </form>
              ) : null}
            </div>
          ) : null,
        ])}
      />

      <h3 className="mt-6 text-sm font-semibold text-ink">Package versions</h3>
      <Table
        empty="No package locked yet."
        head={["Version", "Documents", "Manifest SHA-256", "Locked"]}
        rows={packages.map((p) => [`v${p.version}`, p.manifest.length, <code className="text-xs" key="h">{p.manifestSha256.slice(0, 16)}…</code>, `${when(p.lockedAt)} · ${p.lockedBy ?? ""}`])}
      />

      <h3 className="mt-6 text-sm font-semibold text-ink">Share links</h3>
      <Table
        empty="No share links."
        head={["Lender", "Version", "Expires", "Opens", "State", ""]}
        rows={links.map((l) => {
          const live = !l.revokedAt && Date.parse(l.expiresAt) > now.getTime();
          return [
            lenderName(l.lenderId),
            `v${l.packageVersion}`,
            when(l.expiresAt),
            `${l.accessCount}${l.lastAccessedAt ? ` · last ${when(l.lastAccessedAt)}` : ""}`,
            l.revokedAt ? <Badge key="r" tone="bad">Revoked</Badge> : live ? <Badge key="v" tone="good">Live</Badge> : <Badge key="e">Expired</Badge>,
            write && live ? (
              <form action={revokeLinkAction} key="x">
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="linkId" type="hidden" value={l.id} />
                <Submit tone="glass">Revoke</Submit>
              </form>
            ) : null,
          ];
        })}
      />
    </Section>
  );
}

const NEXT_STATUS: Record<string, { to: "earned" | "void"; label: string }[]> = {
  projected: [
    { to: "earned", label: "Earned" },
    { to: "void", label: "Void" },
  ],
  earned: [{ to: "void", label: "Void" }],
};

async function LedgerPanel({ deal, rt, write }: { deal: Deal; rt: DealDeskRuntime; write: boolean }) {
  const [entries, invoices] = await Promise.all([rt.store.listFeeEntries(deal.id), rt.store.listInvoices(deal.id)]);
  const summary = summarizeLedger(entries);
  const earned = entries.filter((e) => e.status === "earned" && e.payee === "kubera");
  return (
    <Section description="Kubera's own compensation as it will appear on the lender's closing statement. Record keeping only." title="Fee ledger">
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-titanium">Gross compensation</dt>
          <dd className="font-semibold text-ink">{money(summary.grossCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-titanium">Owed to partners</dt>
          <dd className="text-ink">{money(summary.owedToPartnersCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-titanium">Borrower-paid / lender-paid</dt>
          <dd className="text-ink">
            {money(summary.byPayer.borrower)} / {money(summary.byPayer.lender)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-titanium">Settled</dt>
          <dd className="text-ink">{money(summary.byStatus.settled)}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Table
          empty="No ledger entries."
          head={["Entry", "Payer → payee", "Amount", "Status", ""]}
          rows={entries.map((e: FeeEntry) => [
            <span key="d">
              <span className="font-medium">{FEE_ENTRY_LABELS[e.entryKind]}</span>
              <span className="block text-xs text-titanium">{e.description}</span>
            </span>,
            `${e.payer} → ${e.payee.replace(/_/g, " ")}`,
            money(e.amountCents),
            <Badge key="s" tone={e.status === "void" ? "bad" : e.status === "settled" ? "good" : "neutral"}>
              {e.status}
            </Badge>,
            write ? (
              <div className="flex flex-wrap gap-2" key="a">
                {(NEXT_STATUS[e.status] ?? [])
                  .filter((n) => canTransitionFee(e.status, n.to))
                  .map((n) => (
                    <form action={feeStatusAction} className="flex gap-2" key={n.to}>
                      <input name="dealId" type="hidden" value={deal.id} />
                      <input name="entryId" type="hidden" value={e.id} />
                      <input name="to" type="hidden" value={n.to} />
                      {n.to === "void" ? <input aria-label="Reason" className="field w-32" name="reason" placeholder="Reason" required /> : null}
                      <Submit tone="glass">{n.label}</Submit>
                    </form>
                  ))}
              </div>
            ) : null,
          ])}
        />
      </div>
      {write ? (
        <form action={addFeeAction} className="mt-5 grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-3">
          <input name="dealId" type="hidden" value={deal.id} />
          <p className="text-sm font-medium text-ink sm:col-span-3">Add compensation</p>
          <Select
            label="Type"
            name="preset"
            options={[
              { value: "broker_fee", label: "Broker fee (borrower-paid)" },
              { value: "lender_paid", label: "Lender-paid compensation" },
              { value: "agency_split", label: "Agency origination split" },
              { value: "hard_money_points", label: "Hard money points" },
              { value: "sba_packaging", label: "SBA packaging fee (Form 159)" },
              { value: "sba_referral", label: "SBA lender referral fee (Form 159)" },
              { value: "co_broker_split", label: "Co-broker split owed by Kubera" },
            ]}
          />
          <Field hint="Broker %, Kubera share %, or broker points." label="Percent / points" name="pct" step="0.0001" type="number" />
          <Field hint="Flat amount instead of a percent." label="Amount (USD)" name="amount" />
          <Field hint="Agency: lender origination %. Hard money: lender points." label="Lender fee % / points" name="lenderPct" step="0.0001" type="number" />
          <Field hint="Hard money: Kubera's share of lender points." label="Share of lender points (%)" name="sharePct" step="0.01" type="number" />
          <Field label="Counterparty" name="counterparty" placeholder="Lender or partner name" />
          <div className="sm:col-span-3">
            <Submit>Record (projected)</Submit>
          </div>
        </form>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold text-ink">Invoices</h3>
      <Table
        empty="No invoices."
        head={["Number", "Bill to", "Total", "Status", ""]}
        rows={invoices.map((inv) => [
          inv.number,
          `${inv.billToName} (${inv.billToKind})`,
          money(inv.totalCents),
          <Badge key="s" tone={inv.status === "settled" ? "good" : inv.status === "void" ? "bad" : "neutral"}>
            {inv.status.replace(/_/g, " ")}
          </Badge>,
          write && inv.status !== "settled" && inv.status !== "void" ? (
            <div className="flex flex-wrap gap-2" key="a">
              <form action={invoiceAction}>
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="invoiceId" type="hidden" value={inv.id} />
                <input name="op" type="hidden" value="issue" />
                <Submit tone="glass">Email (needs approval)</Submit>
              </form>
              <form action={invoiceAction} className="flex flex-wrap gap-2">
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="invoiceId" type="hidden" value={inv.id} />
                <input name="op" type="hidden" value="settle" />
                <input aria-label="Settled on" className="field w-40" name="settledOn" required type="date" />
                <input aria-label="Closing statement reference" className="field w-48" name="closingStatementRef" placeholder="Closing statement ref" required />
                <Submit tone="glass">Settled</Submit>
              </form>
              <form action={invoiceAction} className="flex gap-2">
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="invoiceId" type="hidden" value={inv.id} />
                <input name="op" type="hidden" value="void" />
                <input aria-label="Void reason" className="field w-32" name="reason" placeholder="Reason" required />
                <Submit tone="glass">Void</Submit>
              </form>
            </div>
          ) : null,
        ])}
      />
      {write && earned.length ? (
        <form action={createInvoiceAction} className="mt-4 grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-2">
          <input name="dealId" type="hidden" value={deal.id} />
          <fieldset className="sm:col-span-2">
            <legend className="field-label">Earned entries</legend>
            {earned.map((e) => (
              <label className="flex items-center gap-2 text-sm" key={e.id}>
                <input name="entryId" type="checkbox" value={e.id} /> {e.description} · {money(e.amountCents)} ({e.payer}-paid)
              </label>
            ))}
          </fieldset>
          <Select
            label="Bill to"
            name="billToKind"
            options={[
              { value: "borrower", label: "Borrower" },
              { value: "lender", label: "Lender" },
            ]}
          />
          <Field label="Bill-to name" name="billToName" required />
          <Field label="Bill-to email" name="billToEmail" type="email" />
          <Field label="Due on" name="dueOn" type="date" />
          <div className="sm:col-span-2">
            <Submit>Draft invoice</Submit>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

async function Form159Panel({ deal, rt, write }: { deal: Deal; rt: DealDeskRuntime; write: boolean }) {
  const forms = await rt.store.listForm159(deal.id);
  return (
    <Section description="Built from the fee ledger; sent for signature by Kubera, the applicant and the lender after broker approval." title="SBA Form 159">
      <Table
        empty="Not generated yet."
        head={["Version", "Total", "Status", "Flags", ""]}
        rows={forms.map((f) => [
          `v${f.version}${f.draft ? " (draft template)" : ""}`,
          money(f.data.totalCents),
          <Badge key="s" tone={f.status === "signed" ? "good" : f.status === "superseded" ? "neutral" : "warn"}>
            {f.status.replace(/_/g, " ")}
          </Badge>,
          <div className="flex flex-wrap gap-1" key="f">
            {f.flags.map((fl) => (
              <Badge key={fl} tone={FORM159_BLOCKING_FLAGS.has(fl as Form159Flag) ? "bad" : "warn"}>
                {fl.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>,
          <div className="flex flex-wrap gap-2" key="a">
            <Link className="pill pill-glass min-h-11" prefetch={false} href={`/deals/${deal.id}/form-159/${f.id}`}>
              PDF
            </Link>
            {write && (f.status === "generated" || f.status === "pending_approval") ? (
              <form action={sendForm159Action}>
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="formId" type="hidden" value={f.id} />
                <Submit tone="glass">Send for signature</Submit>
              </form>
            ) : null}
          </div>,
        ])}
      />
      {write ? (
        <form action={generateForm159Action} className="mt-4 grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-3">
          <input name="dealId" type="hidden" value={deal.id} />
          <Field label="SBA loan number" name="sbaLoanNumber" />
          <Field label="SBA lender" name="lenderName" required />
          <Field label="Lender location ID" name="lenderLocationId" />
          <Field label="Lender signer" name="lenderSignerName" />
          <Field label="Lender signer email" name="lenderSignerEmail" type="email" />
          <Field defaultValue={deal.borrowerName} label="Applicant business" name="applicantName" required />
          <Field label="Applicant signer" name="applicantSignerName" />
          <Field label="Applicant signer email" name="applicantSignerEmail" type="email" />
          <Field label="Applicant signer title" name="applicantSignerTitle" />
          <div className="sm:col-span-3">
            <Submit>Generate from ledger</Submit>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

async function ModificationsPanel({ deal, rt, staff }: { deal: Deal; rt: DealDeskRuntime; staff: StaffSession }) {
  const [mods, loan] = await Promise.all([rt.store.listModifications(deal.id), rt.store.getLoanBrokerOfRecord(deal.id)]);
  const write = can(staff, "write");
  const officer = can(staff, "officer");
  return (
    <Section description="Each change must itself be arranged by a licensed broker (SB 1146). Gate H runs on every change." title="Forbearance, extension and modification">
      {!loan ? <p className="text-sm text-amber-900">Record the loan-level broker-of-record file (gate H) before any change can be submitted.</p> : null}
      <Table
        empty="No changes recorded."
        head={["Change", "Effective", "Status", "Flags", ""]}
        rows={mods.map((m) => [
          m.kind,
          m.facts.effectiveDate,
          <Badge key="s" tone={m.status === "documented" || m.status === "no_exemption_representation" ? "good" : m.status === "held_for_counsel" || m.status === "blocked" ? "bad" : "warn"}>
            {m.status.replace(/_/g, " ")}
          </Badge>,
          <div className="flex flex-wrap gap-1" key="f">
            {m.flags.map((f) => (
              <Badge key={f} tone="warn">
                {f.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>,
          <div className="flex flex-wrap gap-2" key="a">
            {officer && m.evaluation.missing.includes("officer_approval") ? (
              <form action={modificationAction}>
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="modificationId" type="hidden" value={m.id} />
                <input name="op" type="hidden" value="officer_approve" />
                <Submit tone="glass">Officer approve</Submit>
              </form>
            ) : null}
            {write && m.status === "pending_lender_notice" ? (
              <>
                <form action={modificationAction}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="modificationId" type="hidden" value={m.id} />
                  <input name="op" type="hidden" value="retry_notice" />
                  <Submit tone="glass">Check approval</Submit>
                </form>
                <form action={modificationAction}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <input name="modificationId" type="hidden" value={m.id} />
                  <input name="op" type="hidden" value="notice_sent" />
                  <Submit tone="glass">Notice sent</Submit>
                </form>
              </>
            ) : null}
            {write && (m.status === "documented" || m.status === "no_exemption_representation") && !m.termsAppliedAt ? (
              <form action={modificationAction} className="flex flex-wrap gap-2">
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="modificationId" type="hidden" value={m.id} />
                <input name="op" type="hidden" value="apply_terms" />
                <input aria-label="New note rate" className="field w-28" name="noteRatePct" placeholder="Rate %" step="0.001" type="number" />
                <input aria-label="New term in months" className="field w-28" name="termMonths" placeholder="Term (mo)" type="number" />
                <Submit tone="glass">Apply terms</Submit>
              </form>
            ) : null}
            {write && !m.termsAppliedAt && m.status !== "withdrawn" ? (
              <form action={modificationAction}>
                <input name="dealId" type="hidden" value={deal.id} />
                <input name="modificationId" type="hidden" value={m.id} />
                <input name="op" type="hidden" value="withdraw" />
                <Submit tone="glass">Withdraw</Submit>
              </form>
            ) : null}
          </div>,
        ])}
      />
      {write && loan ? (
        <form action={submitModificationAction} className="mt-4 grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-3">
          <input name="dealId" type="hidden" value={deal.id} />
          <Select
            label="Change"
            name="kind"
            options={[
              { value: "extension", label: "Extension" },
              { value: "modification", label: "Modification" },
              { value: "forbearance", label: "Forbearance" },
            ]}
          />
          <Field label="Effective date" name="effectiveDate" required type="date" />
          <Field label="Note rate after change (%)" name="noteRatePct" required step="0.001" type="number" />
          <Select
            label="Arranged by"
            name="arrangedBy"
            options={[
              { value: "kubera", label: "Kubera (licensed broker)" },
              { value: "other_licensed_broker", label: "Another licensed broker" },
              { value: "lender_or_servicer_only", label: "Lender or servicer only" },
            ]}
          />
          <Field label="Other broker name" name="otherBrokerName" />
          <Field label="Other broker DRE #" name="otherBrokerDre" />
          <Select
            label="Kubera acts for"
            name="actsFor"
            options={[
              { value: "", label: "—" },
              { value: "borrower", label: "Borrower" },
              { value: "lender", label: "Lender" },
              { value: "borrower_and_lender", label: "Borrower and lender" },
            ]}
          />
          <Field label="Engagement agreement ref" name="engagementRef" />
          <Field label="Term sheet / negotiation ref" name="termSheetRef" />
          <Field label="Kubera compensation (USD)" name="compensation" step="0.01" type="number" />
          <Select
            label="Paid by"
            name="payer"
            options={[
              { value: "borrower", label: "Borrower" },
              { value: "lender", label: "Lender" },
            ]}
          />
          <Field label="Negotiation summary" name="summary" />
          <div className="flex flex-col gap-2 sm:col-span-3">
            <Check label="Agreement recites that a licensed broker arranged it" name="recital" />
            <Check label="Business-purpose certification on file" name="businessPurpose" />
            <Check defaultChecked label="My DRE license was active on the effective date" name="licenseActive" />
          </div>
          <div className="sm:col-span-3">
            <Submit>Submit for gate H</Submit>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

async function AuditPanel({ deal, rt }: { deal: Deal; rt: DealDeskRuntime }) {
  const entries = await rt.store.auditForDeal(deal.id, 50);
  return (
    <Section description="Append-only; written by database triggers on every change." title="Audit log">
      <Table empty="No history." head={["When", "Record", "Action", "Actor", "Changed"]} rows={entries.map((a) => [when(a.occurredAt), a.tableName, a.action, a.actor, a.changed.join(", ")])} />
    </Section>
  );
}
