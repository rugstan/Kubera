import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LENDER_ACCOUNT_KIND_LABELS, maskedNumber } from "@/lib/deals/lender-accounts";
import { boxNotesFor } from "@/lib/deals/lender-boxes";
import { LENDER_CONTACT_CHANNEL_LABELS, LENDER_CONTACT_ROLE_LABELS, LENDER_CONTACT_SOURCE_LABELS, formatPhone, telHref } from "@/lib/deals/lender-contacts";
import { suggestedLoanTypes } from "@/lib/deals/lender-directory";
import { lenderStaleness } from "@/lib/deals/lenders";
import { LENDER_LOAN_TYPE_LABELS, type LoanTypeReason } from "@/lib/deals/loan-types";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { DEAL_PROGRAM_LABELS, lenderAccountKinds, lenderContactRoles, lenderContactSources, type LenderAccount, type LenderContact, type LenderPanelEntry } from "@/lib/deals/types";
import { piiKeyring } from "@/lib/privacy/crypto";
import {
  addLenderAccountAction,
  addLenderContactAction,
  deleteLenderAccountAction,
  lenderAction,
  lenderContactOpAction,
  saveLenderContactInfoAction,
  saveLenderLoanTypesAction,
  updateLenderAccountAction,
  updateLenderContactAction,
} from "../../actions";
import { Badge, Check, Field, Flash, Loading, LoanTypeBadges, LoanTypeFieldset, NotConfigured, Section, Select, SignInRequired, Submit, Table, TextArea, when } from "../../ui";
import { DirectoryForm } from "./DirectoryForm";
import { RevealAccount } from "./RevealAccount";

export const metadata: Metadata = { title: "Lender" };

type Params = Promise<{ id: string }>;
type Search = Promise<{ notice?: string; error?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_KEY_NOTICE = "Account numbers are unavailable: encryption is not configured on this server. Account numbers cannot be saved or shown until PII_ENCRYPTION_KEY is set; contacts and contact info still save.";

export default function LenderPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="lender" />}>
      <LenderData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** A small form posting one lender-level op (verify / toggle) that returns to this page. */
function LenderOp({ id, op, label }: { id: string; op: "verify" | "toggle"; label: string }) {
  return (
    <form action={lenderAction}>
      <input name="lenderId" type="hidden" value={id} />
      <input name="op" type="hidden" value={op} />
      <input name="back" type="hidden" value="detail" />
      <Submit tone="glass">{label}</Submit>
    </form>
  );
}

/** A one-click contact op. Its accessible name starts with the visible label and names the contact, so rows are told apart. */
function ContactOp({ lenderId, c, op, label }: { lenderId: string; c: LenderContact; op: string; label: string }) {
  return (
    <form action={lenderContactOpAction}>
      <input name="lenderId" type="hidden" value={lenderId} />
      <input name="contactId" type="hidden" value={c.id} />
      <input name="recordVersion" type="hidden" value={c.recordVersion} />
      <input name="op" type="hidden" value={op} />
      <Submit ariaLabel={`${label}: ${c.fullName}`} tone="glass">
        {label}
      </Submit>
    </form>
  );
}

const roleOptions = lenderContactRoles.map((r) => ({ value: r, label: LENDER_CONTACT_ROLE_LABELS[r] }));
const channelOptions = [{ value: "", label: "None" }, ...(["email", "phone", "mobile"] as const).map((c) => ({ value: c, label: LENDER_CONTACT_CHANNEL_LABELS[c] }))];
const staffSources = lenderContactSources.filter((s) => s !== "directory_import").map((s) => ({ value: s, label: LENDER_CONTACT_SOURCE_LABELS[s] }));

/** The contact fields shared by the add and edit forms; `prefix` keeps hint ids unique per form. */
function ContactFields({ c, prefix }: { c?: LenderContact; prefix: string }) {
  const sources = c?.source === "directory_import" ? [{ value: "directory_import", label: LENDER_CONTACT_SOURCE_LABELS.directory_import }, ...staffSources] : staffSources;
  return (
    <>
      <Field autoComplete="off" defaultValue={c?.fullName} idPrefix={prefix} label="Full name" maxLength={120} name="fullName" required />
      <Field autoComplete="off" defaultValue={c?.title} idPrefix={prefix} label="Title" maxLength={120} name="title" />
      <Select defaultValue={c?.role ?? "other"} label="Role" name="role" options={roleOptions} />
      <Field autoComplete="off" defaultValue={c?.email} idPrefix={prefix} label="Email" name="email" spellCheck={false} type="email" />
      <Field autoComplete="off" defaultValue={c?.phoneDirect} idPrefix={prefix} label="Direct phone" name="phoneDirect" type="tel" />
      <Field autoComplete="off" defaultValue={c?.phoneExt} idPrefix={prefix} inputMode="numeric" label="Ext." maxLength={6} name="phoneExt" />
      <Field autoComplete="off" defaultValue={c?.phoneMobile} idPrefix={prefix} label="Mobile" name="phoneMobile" type="tel" />
      <Select defaultValue={c?.preferredChannel ?? ""} label="Preferred channel" name="preferredChannel" options={channelOptions} />
      <Field autoComplete="off" defaultValue={c?.territory} idPrefix={prefix} label="Territory" maxLength={200} name="territory" />
      <Select defaultValue={c?.source ?? "staff"} label="Source" name="source" options={sources} />
      <div className="sm:col-span-2">
        <TextArea defaultValue={c?.notes} hint="No account numbers, passwords or bank details." idPrefix={prefix} label="Notes" maxLength={2000} name="notes" rows={3} />
      </div>
    </>
  );
}

function Detail({ term, children, className }: { term: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-titanium">{term}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

const none = <span className="text-titanium">Not on file</span>;

function address(l: LenderPanelEntry): string | null {
  const cityLine = [l.city, [l.addressState, l.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const parts = [l.addressLine1, l.addressLine2, cityLine, l.country !== "US" ? l.country : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function Phone({ e164, ext }: { e164: string | null; ext?: string | null }) {
  if (!e164) return null;
  return (
    <a className="text-accent underline-offset-2 hover:underline" href={telHref(e164, ext)}>
      {formatPhone(e164)}
      {ext ? ` ext. ${ext}` : ""}
    </a>
  );
}

function Mail({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <a className="break-all text-accent underline-offset-2 hover:underline" href={`mailto:${email}`}>
      {email}
    </a>
  );
}

function External({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a className="break-all text-accent underline-offset-2 hover:underline" href={href} referrerPolicy="no-referrer" rel="noopener noreferrer" target="_blank">
      {href}
    </a>
  );
}

function formatLoanTypeReason(r: LoanTypeReason): string {
  switch (r.kind) {
    case "program":
      return `deal program ${DEAL_PROGRAM_LABELS[r.program]}`;
    case "desk":
      return `directory desk “${r.desk}”`;
    case "keyword":
      return `mentioned: “${r.excerpt}”`;
    case "category":
      return `lender category ${r.category.replace(/_/g, " ").toLowerCase()}`;
    case "bank_life_co":
      return "deal program Bank / life company, and nothing says life company or investor lending";
  }
}

function MaskedHint({ hint }: { hint: string | null }) {
  if (!hint) return <span>Masked</span>;
  return (
    <span>
      <span aria-hidden="true">•••• </span>
      <span className="sr-only">Number ending in </span>
      {hint}
    </span>
  );
}

async function LenderData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired level={1} />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured level={1} />;
  if (!UUID.test(id)) notFound();
  const [lender, contacts, accounts] = await Promise.all([rt.store.getLender(id), rt.store.listLenderContacts(id, { includeLeft: true }), rt.store.listLenderAccounts(id)]);
  if (!lender) notFound();
  const boxNotes = await boxNotesFor(id);
  const { types: suggested, reasons } = await suggestedLoanTypes({ store: rt.store, now: rt.now, boxNotes: async () => boxNotes }, lender);
  const differs = suggested.join(",") !== lender.loanTypes.join(",");
  const write = can(staff, "write");
  const reveal = can(staff, "reveal_account");
  const encryption = Boolean(rt.keyring ?? piiKeyring());
  const incomplete = !lender.mainPhone || !lender.contactEmail || !lender.websiteUrl;
  const appetite = lenderStaleness(lender, rt.now());

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href="/deals/lenders">
          ← Lender panel
        </Link>
        <h1 className="mt-2 break-words text-3xl font-semibold text-ink">{lender.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {lender.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Inactive</Badge>}
          <Badge>{lender.category.replace(/_/g, " ").toLowerCase()}</Badge>
          {lender.brokerFriendly ? <Badge tone="good">Broker-friendly</Badge> : null}
          {lender.contactVerifiedAt ? <Badge tone="good">Contact info verified {when(lender.contactVerifiedAt)}</Badge> : <Badge tone="warn">Contact info not verified</Badge>}
          {incomplete ? <Badge tone="warn">Contact info incomplete</Badge> : null}
          {appetite.stale ? (
            <Badge tone="warn">{appetite.ageDays === null ? "Appetite and split never verified" : `Appetite and split verified ${appetite.ageDays} days ago`}</Badge>
          ) : (
            <Badge tone="good">Appetite and split verified {when(lender.verifiedAt)}</Badge>
          )}
        </div>
        {write ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <LenderOp id={lender.id} label="Appetite and split verified today" op="verify" />
            <LenderOp id={lender.id} label={lender.active ? "Deactivate" : "Reactivate"} op="toggle" />
          </div>
        ) : null}
      </div>
      <Flash error={sp.error} notice={sp.notice} />

      <Section description="How the Lender panel filters this lender. Deal programs, below, still drive matching and stage templates." id="loan-types" title="Loan types">
        <LoanTypeBadges empty="No loan types yet." types={lender.loanTypes} />
        <p className="mt-3 text-sm text-titanium">Deal programs: {lender.programs.map((p) => DEAL_PROGRAM_LABELS[p]).join(", ") || "none"}.</p>
        {differs ? (
          <>
            <p className="mt-3 text-sm">Suggested from its deal programs, directory desk and notes: {suggested.length ? suggested.map((t) => LENDER_LOAN_TYPE_LABELS[t]).join(", ") : "none"}.</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Why these suggestions</summary>
              <ul className="mt-2 grid gap-1 text-sm text-titanium">
                {suggested.map((t) => (
                  <li className="break-words" key={t}>
                    {LENDER_LOAN_TYPE_LABELS[t]}: {(reasons.get(t) ?? []).map(formatLoanTypeReason).join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
        {write ? (
          <div className="mt-4 grid gap-3">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-accent">Edit loan types</summary>
              <form action={saveLenderLoanTypesAction} className="mt-3 grid gap-4">
                <input name="lenderId" type="hidden" value={lender.id} />
                <input name="loanTypesWas" type="hidden" value={lender.loanTypes.join(",")} />
                <LoanTypeFieldset legend="Loan types" name="loanTypes" selected={lender.loanTypes} />
                <div>
                  <Submit name="op" value="save">
                    Save loan types
                  </Submit>
                </div>
              </form>
            </details>
            {differs ? (
              <form action={saveLenderLoanTypesAction}>
                <input name="lenderId" type="hidden" value={lender.id} />
                <input name="loanTypesWas" type="hidden" value={lender.loanTypes.join(",")} />
                <input name="op" type="hidden" value="suggest" />
                <Submit tone="glass">Use the suggested loan types</Submit>
              </form>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section id="contact-info" title="Contact info">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail term="Main phone">{lender.mainPhone ? <Phone e164={lender.mainPhone} ext={lender.mainPhoneExt} /> : none}</Detail>
          <Detail term="Submission inbox">{lender.submissionEmail ? <Mail email={lender.submissionEmail} /> : none}</Detail>
          <Detail term="General inbox">{lender.generalEmail ? <Mail email={lender.generalEmail} /> : none}</Detail>
          <Detail term="Website">{lender.websiteUrl ? <External href={lender.websiteUrl} /> : none}</Detail>
          <Detail term="Broker portal">{lender.portalUrl ? <External href={lender.portalUrl} /> : none}</Detail>
          <Detail term="Address">{address(lender) ?? none}</Detail>
          <Detail term="NMLS ID">{lender.nmlsId ?? none}</Detail>
          <Detail term="Where the portal password is kept">{lender.credentialsLocation ?? none}</Detail>
          <Detail className="sm:col-span-2" term="Submission instructions">
            {lender.submissionInstructions ? <span className="whitespace-pre-wrap">{lender.submissionInstructions}</span> : none}
          </Detail>
          <Detail term="Verified">{lender.contactVerifiedAt ? `${when(lender.contactVerifiedAt)} by ${lender.contactVerifiedBy ?? "staff"}` : "Not verified"}</Detail>
        </dl>
        <p className="mt-4 text-sm text-titanium">
          Corin never sends or receives money through this panel. If anyone emails new payment or wire instructions, call the lender at the main phone above, never at a number in that email.
        </p>
        {write ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-accent">Edit contact info</summary>
            <DirectoryForm action={saveLenderContactInfoAction} className="mt-3 grid gap-4 sm:grid-cols-2">
              <input name="lenderId" type="hidden" value={lender.id} />
              <input name="contactInfoVersion" type="hidden" value={lender.contactInfoVersion} />
              <Field autoComplete="off" defaultValue={lender.mainPhone ? formatPhone(lender.mainPhone) : null} idPrefix="ci" label="Main phone" name="mainPhone" type="tel" />
              <Field autoComplete="off" defaultValue={lender.mainPhoneExt} idPrefix="ci" inputMode="numeric" label="Ext." maxLength={6} name="mainPhoneExt" />
              <Field
                autoComplete="off"
                defaultValue={lender.submissionEmail}
                hint="A shared inbox, for example submissions@lender.com. Put people under Contacts."
                idPrefix="ci"
                label="Submission inbox"
                name="submissionEmail"
                spellCheck={false}
                type="email"
              />
              <Field autoComplete="off" defaultValue={lender.generalEmail} idPrefix="ci" label="General inbox" name="generalEmail" spellCheck={false} type="email" />
              <Field autoComplete="off" defaultValue={lender.websiteUrl} idPrefix="ci" label="Website" name="websiteUrl" spellCheck={false} type="url" />
              <Field autoComplete="off" defaultValue={lender.portalUrl} hint="Link only. Never a username, password or one-time link." idPrefix="ci" label="Broker portal URL" name="portalUrl" spellCheck={false} type="url" />
              <Field autoComplete="off" defaultValue={lender.addressLine1} idPrefix="ci" label="Address line 1" maxLength={200} name="addressLine1" />
              <Field autoComplete="off" defaultValue={lender.addressLine2} idPrefix="ci" label="Address line 2" maxLength={200} name="addressLine2" />
              <Field autoComplete="off" defaultValue={lender.city} idPrefix="ci" label="City" maxLength={100} name="city" />
              <Field autoComplete="off" defaultValue={lender.addressState} idPrefix="ci" label="State" maxLength={2} name="addressState" />
              <Field autoComplete="off" defaultValue={lender.postalCode} idPrefix="ci" label="ZIP / postal code" maxLength={10} name="postalCode" />
              <Field autoComplete="off" defaultValue={lender.country} idPrefix="ci" label="Country" maxLength={2} name="country" />
              <Field autoComplete="off" defaultValue={lender.nmlsId} idPrefix="ci" inputMode="numeric" label="NMLS ID" maxLength={10} name="nmlsId" />
              <Field
                autoComplete="off"
                defaultValue={lender.credentialsLocation}
                hint="For example 1Password › Lenders › Arixa. Never the password itself."
                idPrefix="ci"
                label="Where the portal password is kept"
                maxLength={200}
                name="credentialsLocation"
              />
              <div className="sm:col-span-2">
                <TextArea defaultValue={lender.submissionInstructions} idPrefix="ci" label="Submission instructions" maxLength={4000} name="submissionInstructions" />
              </div>
              <div className="sm:col-span-2">
                <Check label="Contact info verified with the lender today" name="verifiedNow" />
              </div>
              <div className="sm:col-span-2">
                <Submit>Save contact info</Submit>
              </div>
            </DirectoryForm>
          </details>
        ) : null}
      </Section>

      <Section description="People at this lender. The primary contact receives package links; without one, the submission inbox does." id="contacts" title="Contacts">
        <Table
          empty="No contacts yet."
          head={["Name", "Role", "Email", "Phone", "Status", ""]}
          label="Lender contacts"
          rows={contacts.map((c) => [
            <span className="flex flex-col gap-1" key="n">
              <span className="font-medium">{c.fullName}</span>
              {c.title ? <span className="text-xs text-titanium">{c.title}</span> : null}
              <span className="flex flex-wrap gap-1">
                {c.isPrimary ? <Badge tone="good">Primary</Badge> : null}
                {c.status === "left" ? <Badge tone="bad">Left on {when(c.leftAt?.slice(0, 10))}</Badge> : null}
                {c.source === "directory_import" && !c.verifiedAt ? <Badge tone="warn">{LENDER_CONTACT_SOURCE_LABELS.directory_import}</Badge> : null}
              </span>
            </span>,
            LENDER_CONTACT_ROLE_LABELS[c.role],
            c.email ? <Mail email={c.email} key="e" /> : "—",
            <span className="flex flex-col gap-1" key="p">
              {c.phoneDirect ? <Phone e164={c.phoneDirect} ext={c.phoneExt} /> : null}
              {c.phoneMobile ? (
                <span>
                  Mobile <Phone e164={c.phoneMobile} />
                </span>
              ) : null}
              {!c.phoneDirect && !c.phoneMobile ? "—" : null}
            </span>,
            c.status === "active" ? "Active" : "Left",
            write ? (
              <div className="flex flex-wrap gap-2" key="a">
                {c.status === "active" && !c.isPrimary ? <ContactOp c={c} label="Make primary" lenderId={lender.id} op="make_primary" /> : null}
                {c.status === "active" ? <ContactOp c={c} label="Mark as left" lenderId={lender.id} op="mark_left" /> : <ContactOp c={c} label="Reactivate" lenderId={lender.id} op="reactivate" />}
                <ContactOp c={c} label="Verified today" lenderId={lender.id} op="verify" />
              </div>
            ) : null,
          ])}
        />
        {write ? (
          <div className="mt-4 grid gap-3">
            {contacts.map((c) => (
              <details key={c.id}>
                <summary className="cursor-pointer text-sm font-medium text-accent">Edit {c.fullName}</summary>
                <DirectoryForm action={updateLenderContactAction} className="mt-3 grid gap-4 sm:grid-cols-2">
                  <input name="lenderId" type="hidden" value={lender.id} />
                  <input name="contactId" type="hidden" value={c.id} />
                  <input name="recordVersion" type="hidden" value={c.recordVersion} />
                  <ContactFields c={c} prefix={`c-${c.id}`} />
                  <div className="sm:col-span-2">
                    <Submit>Save contact</Submit>
                  </div>
                </DirectoryForm>
                <div className="mt-3">
                  <ContactOp c={c} label="Delete contact" lenderId={lender.id} op="delete" />
                </div>
              </details>
            ))}
            <div className="mt-2">
              <h3 className="text-base font-semibold text-ink">Add a contact</h3>
              <DirectoryForm action={addLenderContactAction} className="mt-3 grid gap-4 sm:grid-cols-2" label="Add a contact">
                <input name="lenderId" type="hidden" value={lender.id} />
                <ContactFields prefix="nc" />
                <div className="sm:col-span-2">
                  <Check label="Make primary contact" name="makePrimary" />
                </div>
                <div className="sm:col-span-2">
                  <Submit>Add contact</Submit>
                </div>
              </DirectoryForm>
            </div>
          </div>
        ) : null}
      </Section>

      <Section
        description="Numbers this lender assigned to Corin, such as a broker ID, our account number at the lender, or a portal username. Stored encrypted and shown masked. Never store passwords, wire instructions or bank account numbers here."
        id="accounts"
        title="Account numbers"
      >
        {!encryption ? (
          <p className="notice-danger mb-4 rounded-2xl px-4 py-3 text-sm" role="status">
            {NO_KEY_NOTICE}
          </p>
        ) : null}
        {/* Label and number come first so a revealed number is readable at 390px without scrolling the table sideways. */}
        <Table
          empty="No account numbers on file."
          head={["Label", "Number", "Type", "Updated"]}
          label="Lender account numbers"
          rows={accounts.map((a: LenderAccount) => [
            a.label,
            <span key="n">
              <MaskedHint hint={a.numberLast4} />
              {reveal && encryption ? <RevealAccount accountId={a.id} label={a.label} lenderId={lender.id} masked={maskedNumber(a.numberLast4)} /> : null}
            </span>,
            LENDER_ACCOUNT_KIND_LABELS[a.kind],
            `${when(a.updatedAt)} by ${a.updatedBy ?? a.createdBy}`,
          ])}
        />
        {write ? (
          <div className="mt-4 grid gap-3">
            {accounts.map((a) => (
              <details key={a.id}>
                <summary className="cursor-pointer text-sm font-medium text-accent">Replace or delete {a.label}</summary>
                {encryption ? (
                  <DirectoryForm action={updateLenderAccountAction} className="mt-3 grid gap-4 sm:grid-cols-2">
                    <input name="lenderId" type="hidden" value={lender.id} />
                    <input name="accountId" type="hidden" value={a.id} />
                    <input name="recordVersion" type="hidden" value={a.recordVersion} />
                    <Field autoComplete="off" defaultValue={a.label} idPrefix={`a-${a.id}`} label="Label" maxLength={80} name="label" />
                    <Field
                      autoComplete="off"
                      hint="Leave blank to keep the current number."
                      idPrefix={`a-${a.id}`}
                      label="New account number"
                      maxLength={64}
                      name="accountNumber"
                      passwordManagerIgnore
                      spellCheck={false}
                    />
                    <div className="sm:col-span-2">
                      <TextArea defaultValue={a.notes} idPrefix={`a-${a.id}`} label="Notes" maxLength={500} name="notes" rows={2} />
                    </div>
                    <div className="sm:col-span-2">
                      <Submit>Save changes</Submit>
                    </div>
                  </DirectoryForm>
                ) : null}
                <form action={deleteLenderAccountAction} className="mt-3">
                  <input name="lenderId" type="hidden" value={lender.id} />
                  <input name="accountId" type="hidden" value={a.id} />
                  <Submit tone="glass">Delete account number</Submit>
                </form>
              </details>
            ))}
            {encryption ? (
              <div className="mt-2">
                <h3 className="text-base font-semibold text-ink">Add an account number</h3>
                <DirectoryForm action={addLenderAccountAction} className="mt-3 grid gap-4 sm:grid-cols-2" label="Add an account number">
                  <input name="lenderId" type="hidden" value={lender.id} />
                  <Select label="Type" name="kind" options={lenderAccountKinds.map((k) => ({ value: k, label: LENDER_ACCOUNT_KIND_LABELS[k] }))} />
                  <Field autoComplete="off" hint="Optional for the standard types, for example Broker ID." idPrefix="na" label="Label" maxLength={80} name="label" />
                  <Field autoComplete="off" idPrefix="na" label="Account number" maxLength={64} name="accountNumber" passwordManagerIgnore required spellCheck={false} />
                  <div className="sm:col-span-2">
                    <TextArea idPrefix="na" label="Notes" maxLength={500} name="notes" rows={2} />
                  </div>
                  <div className="sm:col-span-2">
                    <Submit>Save account number</Submit>
                  </div>
                </DirectoryForm>
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>
    </>
  );
}
