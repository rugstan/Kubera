"use client";

import { useRef, useState } from "react";
import type { PortalPrincipalView } from "../_lib/profile";

// The principal's profile in the borrower portal, one independently saved
// section at a time. Restricted values (tax id, birth date, PFS figures,
// Form 1919 answers) are sent once and never shown back: the page only
// says whether they are on file.

export type ProfileSections = { pfs: boolean; reo: boolean; hud2530: boolean; form1919: boolean; credit: boolean };
type Questions = Record<string, string>;
type Issues = Record<string, string>;
type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

const CITIZENSHIP = [
  ["us_citizen", "U.S. citizen"],
  ["lawful_permanent_resident", "Lawful permanent resident"],
  ["other", "Other"],
] as const;

const PFS_GROUPS = [
  { key: "assets", title: "Assets", fields: [["cash", "Cash and deposits"], ["marketableSecurities", "Marketable securities"], ["retirementAccounts", "Retirement accounts"], ["realEstate", "Real estate (market value)"], ["businessInterests", "Business interests"], ["otherAssets", "Other assets"]] },
  { key: "liabilities", title: "Liabilities", fields: [["mortgages", "Mortgages on real estate"], ["notesPayable", "Notes and loans payable"], ["creditCards", "Credit cards"], ["taxesOwed", "Taxes owed"], ["otherLiabilities", "Other liabilities"]] },
  { key: "contingentLiabilities", title: "Contingent liabilities", fields: [["guarantees", "Guarantees of others' debt"], ["legalClaims", "Lawsuits and claims"], ["other", "Other contingent"]] },
  { key: "annualIncome", title: "Annual income", fields: [["salary", "Salary and wages"], ["investmentIncome", "Investment income"], ["realEstateIncome", "Real estate income"], ["otherIncome", "Other income"]] },
] as const;

const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" ? 0 : Number.isFinite(n) ? n : NaN;
};

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: (aria: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) })}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-ink/80">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[13px] text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SectionShell({ id, title, intro, status, onSubmit, children, submitLabel = "Save" }: { id: string; title: string; intro?: React.ReactNode; status: Status; onSubmit: () => void; children: React.ReactNode; submitLabel?: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="bento mt-8 p-5 sm:p-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {title}
      </h2>
      {intro ? <div className="mt-2 text-[15px] text-ink/80">{intro}</div> : null}
      <form
        noValidate
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" className="pill pill-primary !py-2 !text-[15px]" disabled={status.kind === "saving"}>
            {status.kind === "saving" ? "Saving…" : submitLabel}
          </button>
          <p role={status.kind === "error" ? "alert" : "status"} className={`text-[14px] ${status.kind === "error" ? "text-red-900" : "text-ink/80"}`}>
            {status.message ?? ""}
          </p>
        </div>
      </form>
    </section>
  );
}

export function ProfileForm({ initial, sections, questions, creditText, creditVersion }: { initial: PortalPrincipalView; sections: ProfileSections; questions: Questions; creditText: string; creditVersion: string }) {
  const [p, setP] = useState(initial);
  const versionRef = useRef(initial.version);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [issues, setIssues] = useState<Record<string, Issues>>({});

  async function save(section: string, data: unknown, firstFieldId: string): Promise<boolean> {
    setStatus((s) => ({ ...s, [section]: { kind: "saving" } }));
    setIssues((i) => ({ ...i, [section]: {} }));
    let res: Response;
    try {
      res = await fetch("/portal/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ section, version: versionRef.current, data }) });
    } catch {
      setStatus((s) => ({ ...s, [section]: { kind: "error", message: "Network error. Nothing was saved; please try again." } }));
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as { principal?: PortalPrincipalView; error?: string; issues?: { path: string; message: string }[] };
    if (!res.ok || !body.principal) {
      const map: Issues = {};
      for (const i of body.issues ?? []) map[i.path || "_"] = i.message;
      setIssues((x) => ({ ...x, [section]: map }));
      setStatus((s) => ({ ...s, [section]: { kind: "error", message: res.status === 409 ? "This profile changed in another window. Reload the page and try again." : (body.error ?? "Please check the highlighted fields.") } }));
      const firstPath = Object.keys(map)[0];
      const target = document.getElementById(firstPath ? `${section}-${firstPath.replace(/\./g, "-")}` : firstFieldId);
      target?.focus();
      return false;
    }
    versionRef.current = body.principal.version;
    setP(body.principal);
    setStatus((s) => ({ ...s, [section]: { kind: "saved", message: "Saved." } }));
    return true;
  }

  const err = (section: string, path: string) => issues[section]?.[path];
  const st = (section: string) => status[section] ?? { kind: "idle" };

  // --- Contact --------------------------------------------------------------------------------------
  const [contact, setContact] = useState({ phone: p.phone ?? "", homeAddress: p.homeAddress ?? "", citizenship: p.citizenship ?? "" });
  // --- Identity -------------------------------------------------------------------------------------
  const [identity, setIdentity] = useState({ ssn: "", dob: "" });
  // --- PFS ------------------------------------------------------------------------------------------
  const [pfs, setPfs] = useState<Record<string, string>>({ asOf: new Date().toISOString().slice(0, 10) });
  // --- REO ------------------------------------------------------------------------------------------
  type ReoRow = { address: string; propertyType: string; ownershipPct: string; status: string; marketValue: string; loanBalance: string; lender: string; monthlyDebtService: string; annualNoi: string; maturityDate: string; inDefault: boolean };
  const blankReo: ReoRow = { address: "", propertyType: "", ownershipPct: "100", status: "owned", marketValue: "", loanBalance: "", lender: "", monthlyDebtService: "", annualNoi: "", maturityDate: "", inDefault: false };
  const [reo, setReo] = useState<ReoRow[]>(
    p.reoSchedule.length
      ? p.reoSchedule.map((e) => ({ address: e.address, propertyType: e.propertyType, ownershipPct: String(e.ownershipPct), status: e.status, marketValue: String(e.marketValue), loanBalance: String(e.loanBalance), lender: e.lender ?? "", monthlyDebtService: String(e.monthlyDebtService), annualNoi: String(e.annualNoi), maturityDate: e.maturityDate ?? "", inDefault: e.inDefault }))
      : [],
  );
  // --- HUD-2530 ---------------------------------------------------------------------------------------
  type ProjRow = { projectName: string; fhaOrContractNumber: string; role: string; startDate: string; endDate: string; status: string; defaultOrClaim: boolean; explanation: string };
  const [hud, setHud] = useState({
    noPriorParticipation: p.hud2530?.noPriorParticipation ?? false,
    projects: (p.hud2530?.projects ?? []).map((x) => ({ projectName: x.projectName, fhaOrContractNumber: x.fhaOrContractNumber ?? "", role: x.role, startDate: x.startDate, endDate: x.endDate ?? "", status: x.status, defaultOrClaim: x.defaultOrClaim, explanation: x.explanation ?? "" })) as ProjRow[],
    certifications: p.hud2530?.certifications ?? { noDefaultsLast10Years: false, notDebarredOrSuspended: false, noUnresolvedFindings: false },
  });
  // --- Form 1919 ---------------------------------------------------------------------------------------
  const [f1919, setF1919] = useState<{ answers: Record<string, "yes" | "no" | "">; veteranStatus: string; explanation: string }>({ answers: Object.fromEntries(Object.keys(questions).map((k) => [k, ""])), veteranStatus: "", explanation: "" });
  // --- Credit -------------------------------------------------------------------------------------------
  const [credit, setCredit] = useState({ signatureName: "", agree: false });

  return (
    <>
      <div role="note" aria-label="Notice at collection" className="mt-6 rounded-2xl border border-black/10 bg-surface p-4 text-[13px] leading-relaxed text-ink/80">
        <p>
          <span className="font-semibold text-ink">Notice at collection.</span> We collect your contact details, Social Security number or ITIN, date of birth, personal financial statement, real estate owned, prior HUD participation and SBA eligibility answers to verify your identity, run the credit, background and sanctions checks you authorize, and present your loan request to prospective lenders. Your tax id, birth date, financial statement and eligibility answers are sensitive personal information: we encrypt them and use them only for these purposes. We do not sell your personal information or share it for cross-context behavioral advertising, and we keep it only as long as our{" "}
          <a href="/privacy#retention" target="_blank" rel="noopener" className="font-medium text-accent underline underline-offset-2">
            retention schedule<span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          allows.{" "}
          <a href="/privacy#notice-at-collection" target="_blank" rel="noopener" className="font-medium text-accent underline underline-offset-2">
            Read the full notice and your California privacy rights<span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </div>

      <SectionShell id="contact" title="Contact and residence" status={st("contact")} onSubmit={() => void save("contact", { phone: contact.phone || null, homeAddress: contact.homeAddress, citizenship: contact.citizenship || undefined }, "contact-homeAddress")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-phone" label="Phone" error={err("contact", "phone")}>
            {(a) => <input {...a} type="tel" autoComplete="tel" className="field" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />}
          </Field>
          <Field id="contact-citizenship" label="Citizenship (required)" error={err("contact", "citizenship")}>
            {(a) => (
              <select {...a} className="field" value={contact.citizenship} onChange={(e) => setContact({ ...contact, citizenship: e.target.value })}>
                <option value="">Select one</option>
                {CITIZENSHIP.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field id="contact-homeAddress" label="Home address (required)" error={err("contact", "homeAddress")}>
              {(a) => <input {...a} autoComplete="street-address" className="field" value={contact.homeAddress} onChange={(e) => setContact({ ...contact, homeAddress: e.target.value })} />}
            </Field>
          </div>
        </div>
      </SectionShell>

      <SectionShell
        id="identity"
        title="Identity"
        intro={<p>{p.hasSsn && p.hasDob ? "Your tax id and date of birth are on file (encrypted). Enter them again only to correct them." : "Used for credit, identity and sanctions checks. Stored encrypted; we never display them back."}</p>}
        status={st("identity")}
        onSubmit={() => void save("identity", identity, "identity-ssn").then((ok) => ok && setIdentity({ ssn: "", dob: "" }))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="identity-ssn" label="Social Security number or ITIN (required)" error={err("identity", "ssn")} hint={p.hasSsn ? "On file" : undefined}>
            {(a) => <input {...a} autoComplete="off" inputMode="numeric" spellCheck={false} className="field" value={identity.ssn} onChange={(e) => setIdentity({ ...identity, ssn: e.target.value })} />}
          </Field>
          <Field id="identity-dob" label="Date of birth (required)" error={err("identity", "dob")} hint={p.hasDob ? "On file" : undefined}>
            {(a) => <input {...a} type="date" autoComplete="bday" className="field" value={identity.dob} onChange={(e) => setIdentity({ ...identity, dob: e.target.value })} />}
          </Field>
        </div>
      </SectionShell>

      {sections.pfs ? (
        <SectionShell
          id="pfs"
          title="Personal financial statement"
          intro={<p>{p.hasPfs ? `A statement dated ${p.pfsAsOf} is on file. Submit a new one to replace it.` : "Round figures are fine. Enter 0 for anything that does not apply."}</p>}
          status={st("pfs")}
          onSubmit={() => {
            const data: Record<string, unknown> = { asOf: pfs.asOf };
            for (const g of PFS_GROUPS) data[g.key] = Object.fromEntries(g.fields.map(([k]) => [k, money(pfs[`${g.key}.${k}`] ?? "")]));
            void save("pfs", data, "pfs-asOf");
          }}
        >
          <div className="grid gap-4 sm:max-w-xs">
            <Field id="pfs-asOf" label="Statement date (required)" error={err("pfs", "asOf")}>
              {(a) => <input {...a} type="date" className="field" value={pfs.asOf ?? ""} onChange={(e) => setPfs({ ...pfs, asOf: e.target.value })} />}
            </Field>
          </div>
          {PFS_GROUPS.map((g) => (
            <fieldset key={g.key} className="mt-6">
              <legend className="text-[15px] font-semibold">{g.title}</legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {g.fields.map(([k, label]) => (
                  <Field key={k} id={`pfs-${g.key}-${k}`} label={label} error={err("pfs", `${g.key}.${k}`)}>
                    {(a) => <input {...a} inputMode="decimal" className="field" placeholder="0" value={pfs[`${g.key}.${k}`] ?? ""} onChange={(e) => setPfs({ ...pfs, [`${g.key}.${k}`]: e.target.value })} />}
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
        </SectionShell>
      ) : null}

      {sections.reo ? (
        <SectionShell
          id="reo"
          title="Schedule of real estate owned"
          intro={<p>List every property you own or control, plus any sold in the last three years.</p>}
          status={st("reo")}
          onSubmit={() =>
            void save(
              "reo",
              { entries: reo.map((r) => ({ address: r.address, propertyType: r.propertyType, ownershipPct: money(r.ownershipPct), status: r.status, marketValue: money(r.marketValue), loanBalance: money(r.loanBalance), lender: r.lender || undefined, monthlyDebtService: money(r.monthlyDebtService), annualNoi: money(r.annualNoi), maturityDate: r.maturityDate || undefined, inDefault: r.inDefault })) },
              "reo-add",
            )
          }
        >
          {reo.map((r, i) => {
            const set = (patch: Partial<ReoRow>) => setReo(reo.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            const e = (k: string) => err("reo", `entries.${i}.${k}`);
            return (
              <fieldset key={i} className="mt-4 rounded-2xl border border-black/10 p-4">
                <legend className="px-1 text-[15px] font-semibold">Property {i + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field id={`reo-entries-${i}-address`} label="Address" error={e("address")}>
                      {(a) => <input {...a} className="field" value={r.address} onChange={(ev) => set({ address: ev.target.value })} />}
                    </Field>
                  </div>
                  <Field id={`reo-entries-${i}-propertyType`} label="Property type" error={e("propertyType")}>
                    {(a) => <input {...a} className="field" placeholder="Multifamily" value={r.propertyType} onChange={(ev) => set({ propertyType: ev.target.value })} />}
                  </Field>
                  <Field id={`reo-entries-${i}-status`} label="Status">
                    {(a) => (
                      <select {...a} className="field" value={r.status} onChange={(ev) => set({ status: ev.target.value })}>
                        <option value="owned">Owned</option>
                        <option value="in_contract">In contract to sell</option>
                        <option value="sold_last_3_years">Sold in the last 3 years</option>
                      </select>
                    )}
                  </Field>
                  {(
                    [
                      ["ownershipPct", "Your ownership %"],
                      ["marketValue", "Market value"],
                      ["loanBalance", "Loan balance"],
                      ["monthlyDebtService", "Monthly loan payment"],
                      ["annualNoi", "Annual net operating income"],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} id={`reo-entries-${i}-${k}`} label={label} error={e(k)}>
                      {(a) => <input {...a} inputMode="decimal" className="field" value={r[k]} onChange={(ev) => set({ [k]: ev.target.value })} />}
                    </Field>
                  ))}
                  <Field id={`reo-entries-${i}-lender`} label="Lender">
                    {(a) => <input {...a} className="field" value={r.lender} onChange={(ev) => set({ lender: ev.target.value })} />}
                  </Field>
                  <Field id={`reo-entries-${i}-maturityDate`} label="Loan maturity">
                    {(a) => <input {...a} type="date" className="field" value={r.maturityDate} onChange={(ev) => set({ maturityDate: ev.target.value })} />}
                  </Field>
                  <label className="flex items-center gap-2 self-end text-[15px]">
                    <input type="checkbox" checked={r.inDefault} onChange={(ev) => set({ inDefault: ev.target.checked })} /> Loan in default
                  </label>
                </div>
                <button type="button" className="mt-3 text-[14px] font-medium text-red-900 underline underline-offset-2" onClick={() => setReo(reo.filter((_, j) => j !== i))}>
                  Remove property {i + 1}
                </button>
              </fieldset>
            );
          })}
          <button id="reo-add" type="button" className="pill pill-glass mt-4 !px-4 !py-2 !text-[15px]" onClick={() => setReo([...reo, { ...blankReo }])}>
            Add a property
          </button>
        </SectionShell>
      ) : null}

      {sections.hud2530 ? (
        <SectionShell
          id="hud2530"
          title="Previous participation (HUD-2530)"
          intro={<p>Your HUD-insured or assisted projects. You will also certify in HUD&apos;s APPS system; this lets your advisor prepare it.</p>}
          status={st("hud2530")}
          onSubmit={() => void save("hud2530", { noPriorParticipation: hud.noPriorParticipation, projects: hud.projects.map((x) => ({ ...x, fhaOrContractNumber: x.fhaOrContractNumber || undefined, endDate: x.endDate || undefined, explanation: x.explanation || undefined })), certifications: hud.certifications }, "hud2530-none")}
        >
          <label className="flex items-center gap-2 text-[15px]">
            <input id="hud2530-none" type="checkbox" checked={hud.noPriorParticipation} onChange={(e) => setHud({ ...hud, noPriorParticipation: e.target.checked })} /> I have no prior HUD or government-assisted project participation
          </label>
          {hud.projects.map((x, i) => {
            const set = (patch: Partial<ProjRow>) => setHud({ ...hud, projects: hud.projects.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <fieldset key={i} className="mt-4 rounded-2xl border border-black/10 p-4">
                <legend className="px-1 text-[15px] font-semibold">Project {i + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id={`hud2530-projects-${i}-projectName`} label="Project name" error={err("hud2530", `projects.${i}.projectName`)}>
                    {(a) => <input {...a} className="field" value={x.projectName} onChange={(e) => set({ projectName: e.target.value })} />}
                  </Field>
                  <Field id={`hud2530-projects-${i}-fha`} label="FHA or contract number">
                    {(a) => <input {...a} className="field" value={x.fhaOrContractNumber} onChange={(e) => set({ fhaOrContractNumber: e.target.value })} />}
                  </Field>
                  <Field id={`hud2530-projects-${i}-role`} label="Your role" error={err("hud2530", `projects.${i}.role`)}>
                    {(a) => <input {...a} className="field" value={x.role} onChange={(e) => set({ role: e.target.value })} />}
                  </Field>
                  <Field id={`hud2530-projects-${i}-startDate`} label="From" error={err("hud2530", `projects.${i}.startDate`)}>
                    {(a) => <input {...a} type="date" className="field" value={x.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
                  </Field>
                  <Field id={`hud2530-projects-${i}-endDate`} label="To (blank if active)">
                    {(a) => <input {...a} type="date" className="field" value={x.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
                  </Field>
                  <Field id={`hud2530-projects-${i}-status`} label="Status">
                    {(a) => (
                      <select {...a} className="field" value={x.status} onChange={(e) => set({ status: e.target.value })}>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="terminated">Terminated</option>
                      </select>
                    )}
                  </Field>
                  <label className="flex items-center gap-2 text-[15px] sm:col-span-3">
                    <input type="checkbox" checked={x.defaultOrClaim} onChange={(e) => set({ defaultOrClaim: e.target.checked })} /> A default, assignment, foreclosure or insurance claim occurred
                  </label>
                  <div className="sm:col-span-3">
                    <Field id={`hud2530-projects-${i}-explanation`} label="Explanation (if anything went wrong)">
                      {(a) => <textarea {...a} rows={2} className="field" value={x.explanation} onChange={(e) => set({ explanation: e.target.value })} />}
                    </Field>
                  </div>
                </div>
              </fieldset>
            );
          })}
          <button type="button" className="pill pill-glass mt-4 !px-4 !py-2 !text-[15px]" onClick={() => setHud({ ...hud, projects: [...hud.projects, { projectName: "", fhaOrContractNumber: "", role: "", startDate: "", endDate: "", status: "active", defaultOrClaim: false, explanation: "" }] })}>
            Add a project
          </button>
          <fieldset className="mt-6">
            <legend className="text-[15px] font-semibold">I can certify that</legend>
            {(
              [
                ["noDefaultsLast10Years", "No mortgage default, assignment or foreclosure on a HUD-insured or assisted project in the last 10 years"],
                ["notDebarredOrSuspended", "I am not suspended, debarred or under a limited denial of participation"],
                ["noUnresolvedFindings", "I have no unresolved HUD audit or management review findings"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="mt-2 flex items-start gap-2 text-[15px]">
                <input type="checkbox" className="mt-1" checked={hud.certifications[k]} onChange={(e) => setHud({ ...hud, certifications: { ...hud.certifications, [k]: e.target.checked } })} /> {label}
              </label>
            ))}
          </fieldset>
        </SectionShell>
      ) : null}

      {sections.form1919 ? (
        <SectionShell
          id="form1919"
          title="SBA eligibility questions (Form 1919)"
          intro={<p>{p.hasForm1919 ? "Your answers are on file (encrypted). Submit again to change them." : "Answer each question. A “yes” does not automatically end your request; explain it below and your advisor will review it with the lender."}</p>}
          status={st("form1919")}
          onSubmit={() => {
            const unanswered = Object.entries(f1919.answers).find(([, v]) => v === "");
            if (unanswered) {
              setStatus((s) => ({ ...s, form1919: { kind: "error", message: "Answer every question." } }));
              document.getElementById(`form1919-${unanswered[0]}-yes`)?.focus();
              return;
            }
            void save("form1919", { answers: Object.fromEntries(Object.entries(f1919.answers).map(([k, v]) => [k, v === "yes"])), veteranStatus: f1919.veteranStatus || undefined, explanation: f1919.explanation || undefined }, "form1919-explanation");
          }}
        >
          {Object.entries(questions).map(([k, q]) => (
            <fieldset key={k} className="mt-4">
              <legend className="text-[15px]">{q}</legend>
              <div className="mt-2 flex gap-6 text-[15px]">
                {(["yes", "no"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-2">
                    <input id={`form1919-${k}-${v}`} type="radio" name={`f1919-${k}`} value={v} checked={f1919.answers[k] === v} onChange={() => setF1919({ ...f1919, answers: { ...f1919.answers, [k]: v } })} /> {v === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field id="form1919-veteranStatus" label="Veteran status (optional)">
              {(a) => (
                <select {...a} className="field" value={f1919.veteranStatus} onChange={(e) => setF1919({ ...f1919, veteranStatus: e.target.value })}>
                  <option value="">Prefer not to answer here</option>
                  <option value="not_veteran">Not a veteran</option>
                  <option value="veteran">Veteran</option>
                  <option value="service_disabled_veteran">Service-disabled veteran</option>
                  <option value="spouse_of_veteran">Spouse of a veteran</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field id="form1919-explanation" label="Explanation of any “yes” answer">
                {(a) => <textarea {...a} rows={3} className="field" value={f1919.explanation} onChange={(e) => setF1919({ ...f1919, explanation: e.target.value })} />}
              </Field>
            </div>
          </div>
        </SectionShell>
      ) : null}

      {sections.credit ? (
        <SectionShell
          id="credit"
          title="Credit and background authorization"
          intro={p.creditAuthorizedAt ? <p>You signed this authorization on {p.creditAuthorizedAt.slice(0, 10)}.</p> : null}
          status={st("credit_authorization")}
          submitLabel="Sign authorization"
          onSubmit={() => {
            if (!credit.agree) {
              setStatus((s) => ({ ...s, credit_authorization: { kind: "error", message: "Check the box to sign the authorization." } }));
              document.getElementById("credit-agree")?.focus();
              return;
            }
            void save("credit_authorization", { signatureName: credit.signatureName, textVersion: creditVersion, agree: true }, "credit-signatureName");
          }}
        >
          <p className="rounded-2xl border border-black/10 bg-canvas p-4 text-[14px] leading-relaxed">{creditText}</p>
          <label className="mt-4 flex items-start gap-2 text-[15px]">
            <input id="credit-agree" type="checkbox" className="mt-1" checked={credit.agree} onChange={(e) => setCredit({ ...credit, agree: e.target.checked })} /> I have read and agree to this authorization.
          </label>
          <div className="mt-4 sm:max-w-sm">
            <Field id="credit-signatureName" label={`Type your full legal name (${p.legalName}) to sign`} error={err("credit_authorization", "signatureName")}>
              {(a) => <input {...a} autoComplete="name" className="field" value={credit.signatureName} onChange={(e) => setCredit({ ...credit, signatureName: e.target.value })} />}
            </Field>
          </div>
        </SectionShell>
      ) : null}
    </>
  );
}
