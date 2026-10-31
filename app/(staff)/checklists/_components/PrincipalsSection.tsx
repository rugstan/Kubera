import type { OrgChart } from "@/lib/principals/org-chart";
import { flattenChart } from "@/lib/principals/org-chart";
import type { PrincipalObligations } from "@/lib/principals/requirements";
import { CITIZENSHIP, PRINCIPAL_ROLES, ROLE_LABEL, type Principal } from "@/lib/principals/types";
import type { PfsSummary, ReoSummary } from "@/lib/principals/financials";
import { addPrincipalAction, removePrincipalAction } from "../actions";
import { Badge, Card, usd } from "./ui";

const REQ_LABEL: Record<string, string> = { pfs: "PFS", reo_schedule: "REO", credit_authorization: "Credit auth", government_id: "ID", form_1919: "Form 1919", hud_2530: "HUD-2530", guaranty: "Guaranty", resume: "Résumé" };

export type PrincipalView = { principal: Principal; pfs: PfsSummary | null; reo: ReoSummary | null; flags: string[] };

export function PrincipalsSection({ dealId, chart, views, obligations, canEdit }: { dealId: string; chart: OrgChart; views: Map<string, PrincipalView>; obligations: Map<string, PrincipalObligations>; canEdit: boolean }) {
  const nodes = flattenChart(chart);
  const entities = [...views.values()].map((v) => v.principal).filter((p) => p.kind === "entity");
  return (
    <Card id="principals" title="Principals and ownership">
      {chart.issues.length ? (
        <ul role="list" className="mb-4 rounded-xl border border-amber-700/40 bg-amber-50 p-3 text-[14px] text-amber-900">
          {chart.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      {nodes.length === 0 && chart.orphans.length === 0 ? <p className="text-[15px] text-ink/80">Add the borrowing entity first, then its owners.</p> : null}
      <ul>
        {[...nodes.map((n) => ({ p: n.principal, depth: n.depth, pct: n.effectivePct })), ...chart.orphans.map((p) => ({ p, depth: 0, pct: 0 }))].map(({ p, depth, pct }) => {
          const v = views.get(p.id);
          const ob = obligations.get(p.id);
          return (
            <li key={p.id} className="border-t border-black/10 py-3 first:border-t-0" style={{ paddingLeft: `${Math.min(depth, 5) * 1.25}rem` }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold">
                    {p.legalName} <span className="font-normal text-ink/80">({p.kind})</span>
                  </p>
                  <p className="text-[13px] text-ink/80">
                    {p.roles.map((r) => ROLE_LABEL[r]).join(", ")}
                    {p.ownershipPct !== null ? ` · ${p.ownershipPct}% of parent · ${pct}% effective` : ""}
                    {p.email ? ` · ${p.email}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                    {p.kind === "individual" ? (
                      <>
                        <Badge tone={p.hasSsn ? "good" : "muted"}>{p.hasSsn ? "Tax id on file (encrypted)" : "No tax id"}</Badge>
                        <Badge tone={p.hasDob ? "good" : "muted"}>{p.hasDob ? "DOB on file" : "No DOB"}</Badge>
                        <Badge tone={p.creditAuthorization ? "good" : "muted"}>{p.creditAuthorization ? `Credit auth signed ${p.creditAuthorization.consentedAt.slice(0, 10)}` : "Credit auth not signed"}</Badge>
                      </>
                    ) : null}
                    {ob ? [...ob.requirements].map((r) => <Badge key={r} tone="muted">{REQ_LABEL[r] ?? r}</Badge>) : null}
                  </p>
                  {v?.pfs ? (
                    <p className="mt-1 text-[13px]">
                      PFS {p.pfsAsOf}: net worth {usd(v.pfs.netWorth)}, liquidity {usd(v.pfs.liquidity)}, contingent {usd(v.pfs.contingentLiabilities)}
                      {v.pfs.stale ? " — older than 90 days" : ""}
                    </p>
                  ) : null}
                  {v?.reo ? (
                    <p className="mt-1 text-[13px]">
                      REO: {v.reo.properties} properties, value {usd(v.reo.marketValue)}, debt {usd(v.reo.debt)}, DSCR {v.reo.dscr ?? "—"}, {v.reo.maturingWithin24Months} maturing within 24 months
                    </p>
                  ) : null}
                  {v?.flags.length ? (
                    <ul className="mt-1 list-disc pl-5 text-[13px] text-amber-900">
                      {v.flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {canEdit ? (
                  <form action={removePrincipalAction}>
                    <input type="hidden" name="dealId" value={dealId} />
                    <input type="hidden" name="principalId" value={p.id} />
                    <button type="submit" className="text-[14px] font-medium text-red-900 underline underline-offset-2">
                      Remove<span className="sr-only"> {p.legalName}</span>
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <details className="mt-4 rounded-xl border border-black/10 p-4">
        <summary className="cursor-pointer text-[15px] font-medium">Add a principal</summary>
        <form action={addPrincipalAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="dealId" value={dealId} />
          <div>
            <label className="field-label" htmlFor="pr-name">Legal name</label>
            <input id="pr-name" name="legalName" required minLength={2} className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-kind">Type</label>
            <select id="pr-kind" name="kind" className="field">
              <option value="individual">Individual</option>
              <option value="entity">Entity</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="pr-parent">Owns or controls</label>
            <select id="pr-parent" name="parentId" className="field">
              <option value="">— (this is the borrowing entity)</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legalName}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="sm:col-span-3">
            <legend className="field-label">Roles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
              {PRINCIPAL_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2">
                  <input type="checkbox" name="roles" value={r} /> {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="field-label" htmlFor="pr-pct">Ownership % of that entity</label>
            <input id="pr-pct" name="ownershipPct" inputMode="decimal" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-title">Title</label>
            <input id="pr-title" name="title" className="field" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" name="isGuarantor" /> Named guarantor
            </label>
          </div>
          <div>
            <label className="field-label" htmlFor="pr-email">Email</label>
            <input id="pr-email" name="email" type="email" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-phone">Phone</label>
            <input id="pr-phone" name="phone" type="tel" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-state">State of formation (entities)</label>
            <input id="pr-state" name="formationState" maxLength={2} className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-cit">Citizenship (individuals)</label>
            <select id="pr-cit" name="citizenship" className="field">
              <option value="">Not provided</option>
              {CITIZENSHIP.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="pr-ssn">SSN or ITIN (encrypted)</label>
            <input id="pr-ssn" name="ssn" autoComplete="off" inputMode="numeric" className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-dob">Date of birth (encrypted)</label>
            <input id="pr-dob" name="dob" type="date" autoComplete="off" className="field" />
          </div>
          <button type="submit" className="pill pill-primary !py-2 !text-[15px] sm:col-span-3 sm:justify-self-start">Add principal</button>
        </form>
      </details>
    </Card>
  );
}
