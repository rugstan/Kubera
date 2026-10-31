import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Field, Flash, Loading, Section, Select, Submit, Table, when } from "@/app/(staff)/deals/ui";
import { requireStaff } from "@/lib/auth/dal";
import { outreachBlock } from "@/lib/agents/intel/outreach";
import { intelRuntime, outreachDeps, type IntelRuntime } from "@/lib/agents/intel/runtime";
import { OUTREACH_CHANNELS, PROSPECT_STATUSES, PROSPECT_STATUS_LABELS, SUPPRESSION_REASONS, type OutreachChannel, type Prospect, type ProspectOutreach } from "@/lib/agents/intel/types";
import { cancelOutreachAction, draftOutreachAction, markMailedAction, settleOutreachAction, suppressProspectAction, updateProspectAction } from "../actions";
import { OutreachBadge, ScoreBar, StatusBadge, day, dollars, programLabel, typeLabel, windowLabel } from "../_components/format";
import { UUID } from "../_lib/forms";

export const metadata: Metadata = { title: "Prospect" };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default function ProspectPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="prospect" />}>
      <ProspectData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProspectData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  await requireStaff(`/prospects/${id}`);
  const rt = await intelRuntime();
  if (!rt) return <p className="bento p-6 text-sm text-titanium">Prospecting storage is not configured.</p>;
  const p = await rt.prospects.getProspect(id);
  if (!p) notFound();
  const outreach = await rt.prospects.listOutreach(id);
  const blocks = await blocksFor(rt, p);
  const notice = typeof sp.notice === "string" ? sp.notice : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <>
      <Link className="text-sm text-titanium hover:text-ink" href="/prospects">
        ← All prospects
      </Link>
      <div>
        <p className="eyebrow">Prospect</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{p.addressLine1}</h1>
        <p className="mt-1 text-sm text-titanium">
          {[p.city, p.state, p.zip].filter(Boolean).join(", ")} · {typeLabel(p)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StatusBadge status={p.status} />
          <ScoreBar score={p.score} />
          <span className="text-sm text-titanium">Starting point: {programLabel(p.recommendedProgram)}</span>
        </div>
      </div>
      <Flash error={error} notice={notice} />
      {rt.mode === "demo" ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Demo data: this property and owner are invented.</p> : null}

      <Section title="Why this score" description="Each factor is scored on its own. Thresholds are starting points for the desk to tune; the program is a conversation starter, not an eligibility finding.">
        <Table
          empty=""
          head={["Factor", "Points", "Why"]}
          label="Score factors table"
          rows={p.scoreFactors.map((f) => [f.factor, `${f.points} of ${f.max}`, f.detail])}
        />
      </Section>

      <Section title="Recorded loan and property" description={`From ${p.source === "fake" ? "demo data" : p.source.toUpperCase()}, current as of ${day(p.dataAsOf)}. Confirm with the owner before relying on any of it.`}>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Stated maturity" value={`${day(p.loanMaturityDate)} (${windowLabel(p.windowBucket)})`} />
          <Fact label="Original loan" value={dollars(p.loanOriginalCents)} />
          <Fact label="Recorded rate" value={p.loanRatePct !== null ? `${p.loanRatePct}%` : "Unknown"} />
          <Fact label="Recorded lender" value={p.loanLender ?? "Unknown"} />
          <Fact label="Originated" value={day(p.loanOriginationDate)} />
          <Fact label="Loan type" value={p.loanType ?? "Unknown"} />
          <Fact label="Last sale" value={p.lastSaleDate ? `${day(p.lastSaleDate)}${p.lastSalePriceCents ? `, ${dollars(p.lastSalePriceCents)}` : ""}` : "Unknown"} />
          <Fact label="APN" value={p.apn ?? "Unknown"} />
          <Fact label="Year built" value={p.yearBuilt ? String(p.yearBuilt) : "Unknown"} />
          <Fact label="Owner of record" value={`${p.ownerName ?? "Unknown"} (${p.ownerKind === "unknown" ? "type unclear" : p.ownerKind})`} />
          <Fact label="Owner mailing address" value={p.mailing?.line1 ? [p.mailing.line1, p.mailing.city, [p.mailing.state, p.mailing.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "Not in the record"} />
          <Fact label="Last scanned" value={when(p.lastScannedAt)} />
        </dl>
      </Section>

      <Section title="Contact, status and notes" description="Public records carry no email address. Add one only if the owner gave it to you or it is published as a business contact.">
        <form action={updateProspectAction} className="grid gap-4 sm:grid-cols-2">
          <input name="prospectId" type="hidden" value={p.id} />
          <Field defaultValue={p.contactName} label="Contact name" name="contactName" />
          <Field defaultValue={p.contactEmail} label="Contact email" name="contactEmail" type="email" />
          <Select defaultValue={p.status} label="Status" name="status" options={PROSPECT_STATUSES.map((s) => ({ value: s, label: PROSPECT_STATUS_LABELS[s] }))} />
          <Field defaultValue={p.assignedTo} label="Assigned advisor" name="assignedTo" />
          <label className="block sm:col-span-2">
            <span className="field-label">Notes</span>
            <textarea className="field" defaultValue={p.notes ?? ""} maxLength={4000} name="notes" rows={3} />
          </label>
          <div className="sm:col-span-2">
            <Submit>Save</Submit>
          </div>
        </form>
      </Section>

      <Section title="Outreach" description="A draft is requested through the approvals queue. An email is sent, or a letter is released for mailing, only after a broker approves it. An approval that times out expires and sends nothing.">
        <div className="grid gap-4 md:grid-cols-2">
          {OUTREACH_CHANNELS.map((channel) => (
            <DraftForm blocked={blocks[channel]} channel={channel} key={channel} prospect={p} />
          ))}
        </div>
        <div className="mt-6 space-y-4">
          {outreach.length === 0 ? <p className="text-sm text-titanium">No outreach drafted yet.</p> : outreach.map((o) => <OutreachCard key={o.id} o={o} prospectId={p.id} />)}
        </div>
      </Section>

      <Section title="Do not contact" description="Adds this prospect's email, owner name and addresses to the do-not-contact list. Future scans and drafts skip them, and a draft already waiting is blocked.">
        <form action={suppressProspectAction} className="flex flex-wrap items-end gap-3">
          <input name="prospectId" type="hidden" value={p.id} />
          <Select label="Reason" name="reason" options={SUPPRESSION_REASONS.map((r) => ({ value: r, label: { opt_out: "Asked not to be contacted", complaint: "Complaint", bounce: "Address bounced", staff: "Staff decision" }[r] }))} />
          <Submit tone="glass">Add to do-not-contact list</Submit>
        </form>
      </Section>
    </>
  );
}

async function blocksFor(rt: IntelRuntime, p: Prospect): Promise<Record<OutreachChannel, string | null>> {
  const deps = outreachDeps(rt);
  const out = {} as Record<OutreachChannel, string | null>;
  for (const channel of OUTREACH_CHANNELS) out[channel] = (await outreachBlock(deps, p, channel))?.message ?? null;
  return out;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-titanium">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function DraftForm({ prospect, channel, blocked }: { prospect: Prospect; channel: OutreachChannel; blocked: string | null }) {
  const label = channel === "email" ? "Draft an email" : "Draft a letter";
  return (
    <form action={draftOutreachAction} className="rounded-2xl border border-black/10 p-4">
      <input name="prospectId" type="hidden" value={prospect.id} />
      <input name="channel" type="hidden" value={channel} />
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      <p className="mt-1 text-xs text-titanium">{channel === "email" ? `To ${prospect.contactEmail ?? "no email on file"}` : `To the owner's mailing address${prospect.mailing?.line1 ? ` (${prospect.mailing.line1})` : ""}`}</p>
      {blocked ? (
        <p className="mt-3 text-sm text-amber-900" role="status">
          {blocked}
        </p>
      ) : (
        <>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
            <input className="size-4 accent-[var(--color-accent)]" name="personalize" type="checkbox" />
            Let the AI write the opening two sentences (checked against the compliance rules)
          </label>
          <div className="mt-2">
            <Submit tone="glass">{label}</Submit>
          </div>
        </>
      )}
    </form>
  );
}

function OutreachCard({ o, prospectId }: { o: ProspectOutreach; prospectId: string }) {
  return (
    <article aria-label={`Draft version ${o.version}`} className="rounded-2xl border border-black/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <OutreachBadge status={o.status} />
        <Badge>{o.channel === "email" ? "Email" : "Letter"}</Badge>
        <Badge>{o.generatedBy === "model" ? "AI-written opening" : "Template"}</Badge>
        <span className="text-xs text-titanium">
          Version {o.version} · drafted {when(o.createdAt)} by {o.draftedBy.replace(/^staff:/, "")}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink">
        <span className="text-titanium">To </span>
        {o.recipient}
      </p>
      <p className="text-sm font-medium text-ink">{o.subject}</p>
      {o.error ? <p className="mt-1 text-sm text-red-900">{o.error}</p> : null}
      {o.sentAt ? <p className="mt-1 text-xs text-titanium">Sent {when(o.sentAt)}</p> : null}
      {o.mailedAt ? <p className="mt-1 text-xs text-titanium">Mailed {when(o.mailedAt)} by {o.mailedBy}</p> : null}
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer text-sm text-accent">Read the message</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-sm text-ink">{o.bodyText}</pre>
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        {o.status === "pending_approval" ? (
          <form action={settleOutreachAction}>
            <input name="prospectId" type="hidden" value={prospectId} />
            <input name="outreachId" type="hidden" value={o.id} />
            <Submit tone="glass">Check for broker decision</Submit>
          </form>
        ) : null}
        {o.status === "ready_to_mail" ? (
          <form action={markMailedAction}>
            <input name="prospectId" type="hidden" value={prospectId} />
            <input name="outreachId" type="hidden" value={o.id} />
            <Submit>Mark as mailed</Submit>
          </form>
        ) : null}
        {o.status === "pending_approval" || o.status === "ready_to_mail" ? (
          <form action={cancelOutreachAction}>
            <input name="prospectId" type="hidden" value={prospectId} />
            <input name="outreachId" type="hidden" value={o.id} />
            <Submit tone="glass">Cancel</Submit>
          </form>
        ) : null}
        {o.status === "pending_approval" ? (
          <Link className="pill pill-glass min-h-11" href="/approvals">
            Open approvals
          </Link>
        ) : null}
      </div>
    </article>
  );
}
