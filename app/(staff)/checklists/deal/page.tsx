import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { deskServices, checklistDeps } from "@/lib/checklists/server";
import { dealClosingGate, settleDealScans } from "@/lib/checklists/service";
import { canDecide } from "@/lib/checklists/staff";
import { CHECKLIST_PROGRAMS, PROGRAM_LABEL } from "@/lib/checklists/types";
import { openPrincipalSecrets } from "@/lib/principals/crypto-fields";
import { form1919Flags, hud2530Flags, summarizePfs, summarizeReo } from "@/lib/principals/financials";
import { buildForm1919Prefill } from "@/lib/principals/form1919";
import { buildOrgChart } from "@/lib/principals/org-chart";
import type { Form1919Answers } from "@/lib/principals/types";
import { principalObligations } from "@/lib/principals/requirements";
import { toPublicPrincipal } from "@/lib/principals/service";
import { createChecklistAction, revokeInviteAction } from "../actions";
import { currentStaff } from "../_lib/session";
import { ConditionsSection } from "../_components/ConditionsSection";
import { Form1919Section } from "../_components/Form1919Section";
import { HardMoneySection } from "../_components/HardMoneySection";
import { InviteForm } from "../_components/InviteForm";
import { ItemsSection } from "../_components/ItemsSection";
import { PrincipalsSection, type PrincipalView } from "../_components/PrincipalsSection";
import { ScreeningSection } from "../_components/ScreeningSection";
import { Badge, Card, date, first, Notice, SignIn, type SearchParams } from "../_components/ui";

export const metadata: Metadata = { title: "Deal checklist" };

export default function DealChecklistPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <p className="eyebrow">
        <Link href="/checklists" className="underline-offset-2 hover:underline">
          Deal desk
        </Link>
      </p>
      <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Deal file</h1>
      <div className="mt-6">
        <Suspense fallback={<p className="text-[15px] text-ink/80">Loading the deal…</p>}>
          <DealDesk searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function DealDesk({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = first(sp.id) ?? "";
  const staff = await currentStaff();
  if (!staff) return <SignIn />;
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return <Card title="Not a deal id"><p className="text-[15px]">Deal ids are UUIDs from the pipeline.</p></Card>;
  const dealId = parsed.data;
  const s = deskServices();
  if (!s) return <Card title="The deal desk is not available"><p className="text-[15px]">The database is not configured for this deployment.</p></Card>;

  await connection();
  const now = s.now?.() ?? new Date();
  const deps = checklistDeps(s);
  // Backstop for the scan hook: apply finished malware scans to portal uploads before reading.
  await settleDealScans(deps, dealId).catch((err) => console.error("[checklists] scan settle failed", err instanceof Error ? err.message : err));
  const [checklists, items, files, conditions, principalRows, screenings, holds, invites, hm, gate] = await Promise.all([
    s.checklists.checklistsForDeal(dealId),
    s.checklists.itemsForDeal(dealId),
    s.checklists.filesForDeal(dealId),
    s.checklists.conditionsForDeal(dealId),
    s.principals.forDeal(dealId),
    s.screenings.forDeal(dealId),
    s.holds.active(dealId),
    s.invites.forDeal(dealId),
    s.checklists.getHmUnderwriting(dealId),
    dealClosingGate(deps, dealId),
  ]);
  const principals = principalRows.map(toPublicPrincipal);
  const chart = buildOrgChart(principals);
  const obligations = principalObligations(checklists.map((c) => c.program), principals, chart);

  const views = new Map<string, PrincipalView>();
  const answers1919 = new Map<string, Form1919Answers>();
  for (const row of principalRows) {
    const flags: string[] = [];
    let pfs = null;
    let reo = null;
    if (row.kind === "individual" && (row.pfsEnc || row.form1919Enc)) {
      try {
        const open = openPrincipalSecrets(row, { keyring: s.keyring, fields: ["pfs", "form_1919"] });
        if (open.pfs) pfs = summarizePfs(open.pfs, now);
        if (open.form1919) {
          answers1919.set(row.id, open.form1919);
          for (const f of form1919Flags(open.form1919)) flags.push(`Form 1919 "yes": ${f.text}`);
        }
      } catch {
        flags.push("Encrypted fields could not be opened with the configured key.");
      }
    }
    if (row.reoSchedule) {
      reo = summarizeReo(row.reoSchedule, now);
      flags.push(...reo.flags);
    }
    if (row.hud2530) flags.push(...hud2530Flags(row.hud2530).map((f) => `HUD-2530: ${f}`));
    views.set(row.id, { principal: toPublicPrincipal(row), pfs, reo, flags });
  }
  const sba = checklists.some((c) => c.program === "SBA_7A" || c.program === "SBA_504");
  // Loan amount, use of proceeds and business address come from the deal record (WS-I/T) once it is wired in.
  const prefill1919 = sba ? buildForm1919Prefill({ principals, deal: { loanAmount: null }, answers: answers1919 }) : null;
  const missingPrograms = CHECKLIST_PROGRAMS.filter((p) => !checklists.some((c) => c.program === p));

  return (
    <>
      <p className="font-mono text-[13px] text-ink/80">{dealId}</p>
      <div className="mt-4">
        <Notice ok={first(sp.ok)} error={first(sp.error)} />
      </div>

      <section aria-labelledby="gate-title" className={`mb-8 rounded-3xl p-5 sm:p-7 ${gate.held ? "notice-danger" : gate.ready ? "notice-success" : "notice-warning"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="gate-title" className="text-xl font-semibold">
            {gate.held ? "On hold" : gate.ready ? "Checklist side ready for closing" : "Not ready for closing"}
          </h2>
          <Badge tone={gate.held ? "bad" : gate.ready ? "good" : "warn"}>{gate.reasons.length} open point(s)</Badge>
        </div>
        <p className="mt-1 text-[13px] text-ink/80">Checklists, conditions, principals and screening. The MLDS and broker-of-record gates are checked separately in the pipeline.</p>
        {gate.reasons.length ? (
          <ul className="mt-3 list-disc pl-5 text-[14px]">
            {gate.reasons.slice(0, 30).map((r) => (
              <li key={r}>{r}</li>
            ))}
            {gate.reasons.length > 30 ? <li>…and {gate.reasons.length - 30} more</li> : null}
          </ul>
        ) : null}
      </section>

      <ScreeningSection dealId={dealId} gate={gate.screening} screenings={screenings} holds={holds} configured={Boolean(s.sanctions)} />
      <PrincipalsSection dealId={dealId} chart={chart} views={views} obligations={obligations} canEdit={canDecide(staff)} />
      {prefill1919 ? <Form1919Section prefill={prefill1919} /> : null}

      {checklists.map((c) => (
        <ItemsSection key={c.id} checklist={c} readiness={gate.checklists.find((g) => g.checklist.id === c.id)!.readiness} items={items.filter((i) => i.checklistId === c.id)} files={files} now={now} />
      ))}
      {missingPrograms.length ? (
        <Card id="checklists" title={checklists.length ? "Add another program's checklist" : "Start the checklist"}>
          <form action={createChecklistAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="dealId" value={dealId} />
            <div>
              <label className="field-label" htmlFor="add-program">Program</label>
              <select id="add-program" name="program" className="field">
                {missingPrograms.map((p) => (
                  <option key={p} value={p}>
                    {PROGRAM_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="pill pill-primary !py-2 !text-[15px]">Add checklist</button>
          </form>
        </Card>
      ) : null}

      <ConditionsSection dealId={dealId} conditions={conditions} items={items} />
      {checklists.some((c) => c.program === "HARD_MONEY") || hm ? <HardMoneySection dealId={dealId} file={hm} /> : null}

      <Card id="portal" title="Borrower portal links">
        {canDecide(staff) ? <InviteForm dealId={dealId} principals={principals.filter((p) => p.kind === "individual").map((p) => ({ id: p.id, name: p.legalName, email: p.email }))} /> : <p className="text-[15px]">A broker or admin issues portal links.</p>}
        {invites.length ? (
          <ul className="mt-5 text-[14px]">
            {invites.map((inv) => {
              const state = inv.revokedAt ? "revoked" : inv.consumedAt ? (inv.sessionExpiresAt && Date.parse(inv.sessionExpiresAt) > now.getTime() ? "in use" : "used") : Date.parse(inv.expiresAt) <= now.getTime() ? "expired" : "not opened yet";
              return (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 py-2">
                  <span>
                    {inv.email} · issued {date(inv.createdAt)} by {inv.createdBy} · {state}
                  </span>
                  {!inv.revokedAt && canDecide(staff) ? (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="dealId" value={dealId} />
                      <input type="hidden" name="inviteId" value={inv.id} />
                      <button type="submit" className="text-[14px] font-medium text-danger underline underline-offset-2">
                        Revoke<span className="sr-only"> link for {inv.email}</span>
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
