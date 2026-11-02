"use client";

import { useId, useRef, useState } from "react";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";

// Public privacy request form (/privacy#request). Posts to
// /api/privacy/request, which files a ticket in the compliance queue.

type RequestType = "human_review" | "access" | "deletion" | "correction" | "opt_out_sale_share";

export const REQUEST_OPTIONS: { value: RequestType; label: string; hint: string }[] = [
  { value: "human_review", label: "Advisor-only handling", hint: "An advisor handles your requests personally, without automated scoring and without sending your personal information to automated tools. Takes effect right away." },
  { value: "access", label: "Get a copy of my information", hint: "We verify your identity first, then send you what we hold about you." },
  { value: "deletion", label: "Delete my information", hint: "We verify your identity first. Some records, such as required loan disclosures, must be kept for a time." },
  { value: "correction", label: "Correct my information", hint: "Tell us what is wrong and what it should say." },
  { value: "opt_out_sale_share", label: "Do not sell or share", hint: "We do not sell or share personal information; we will record your choice anyway." },
];

type FieldErrors = Partial<Record<"type" | "name" | "email" | "agentName" | "details" | "attest", string>>;

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-[13px] font-medium text-red-700">
      {message}
    </p>
  );
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "done"; message: string; reference: string; respondBy?: string } | { kind: "error"; message: string };

export function PrivacyRequestForm({ privacyEmail, defaultType = "human_review" }: { privacyEmail: string; defaultType?: RequestType }) {
  const id = useId();
  const [type, setType] = useState<RequestType>(defaultType);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agent, setAgent] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [details, setDetails] = useState("");
  const [attest, setAttest] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const statusRef = useRef<HTMLDivElement>(null);
  const turnstile = useTurnstile("privacy");

  const fid = (f: string) => `${id}-${f}`;
  const err = (f: keyof FieldErrors) => (errors[f] ? { "aria-invalid": true, "aria-describedby": `${fid(f)}-error` } : {});
  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Enter a valid email address.";
    if (agent && !agentName.trim()) e.agentName = "Enter the authorized agent's name.";
    if (type === "correction" && !details.trim()) e.details = "Tell us what to correct.";
    if (!attest) e.attest = "Please confirm before sending.";
    return e;
  }

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0]!;
      document.getElementById(fid(first))?.focus();
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const captcha = await turnstile.getToken();
      const res = await fetch("/api/privacy/request", {
        method: "POST",
        headers: { "content-type": "application/json", ...turnstileHeaders(captcha) },
        body: JSON.stringify({
          type,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          relationship: agent ? "authorized_agent" : "self",
          ...(agent ? { agentName: agentName.trim() } : {}),
          ...(details.trim() ? { details: details.trim() } : {}),
          attest: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; reference?: string; respondBy?: string; error?: string; issues?: { path: string; message: string }[] };
      if (!res.ok) {
        const fieldErrors: FieldErrors = {};
        for (const i of json.issues ?? []) if (["type", "name", "email", "agentName", "details", "attest"].includes(i.path)) fieldErrors[i.path as keyof FieldErrors] = i.message;
        setErrors(fieldErrors);
        setStatus({ kind: "error", message: json.error ?? `We could not send your request. Please email ${privacyEmail}.` });
      } else {
        setStatus({ kind: "done", message: json.message ?? "We received your request.", reference: json.reference ?? "", respondBy: json.respondBy });
      }
    } catch {
      setStatus({ kind: "error", message: `We could not reach our servers. Please email ${privacyEmail}.` });
    }
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  if (status.kind === "done") {
    return (
      <div ref={statusRef} tabIndex={-1} role="status" className="bento mt-6 p-6" data-privacy-request-result>
        <p className="text-lg font-semibold text-ink">Request received</p>
        <p className="mt-2">{status.message}</p>
        {status.reference ? (
          <p className="mt-2 text-[14px] text-ink/70">
            Reference: <span className="font-mono">{status.reference}</span>. Keep it if you write to {privacyEmail} about this request.
          </p>
        ) : null}
      </div>
    );
  }

  const selected = REQUEST_OPTIONS.find((o) => o.value === type)!;

  return (
    <form noValidate onSubmit={onSubmit} className="bento mt-6 space-y-5 p-6" aria-describedby={fid("required")} data-privacy-request-form>
      <p id={fid("required")} className="text-[13px] text-ink/70">
        Fields marked <span className="text-accent">*</span> are required.
      </p>

      <fieldset>
        <legend className="field-label">
          What would you like us to do?<span className="text-accent"> *</span>
        </legend>
        <div className="mt-1 space-y-2">
          {REQUEST_OPTIONS.map((o) => (
            <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-black/10 px-3 py-2.5 has-[:checked]:border-accent">
              <input type="radio" name={fid("type")} value={o.value} checked={type === o.value} onChange={() => setType(o.value)} className="mt-1 accent-[var(--color-accent)]" />
              <span className="text-[15px] text-ink">{o.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-ink/70" aria-live="polite">
          {selected.hint}
        </p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={fid("name")} className="field-label">
            Full name<span className="text-accent"> *</span>
          </label>
          <input id={fid("name")} className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required {...err("name")} />
          <ErrorText id={`${fid("name")}-error`} message={errors.name} />
        </div>
        <div>
          <label htmlFor={fid("email")} className="field-label">
            Email you used with us<span className="text-accent"> *</span>
          </label>
          <input id={fid("email")} className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required {...err("email")} />
          <ErrorText id={`${fid("email")}-error`} message={errors.email} />
        </div>
        <div>
          <label htmlFor={fid("phone")} className="field-label">
            Phone (optional)
          </label>
          <input id={fid("phone")} className="field" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          I am an authorized agent making this request for someone else
        </label>
        {agent ? (
          <div className="mt-2">
            <label htmlFor={fid("agentName")} className="field-label">
              Agent name or firm<span className="text-accent"> *</span>
            </label>
            <input id={fid("agentName")} className="field" value={agentName} onChange={(e) => setAgentName(e.target.value)} {...err("agentName")} />
            <ErrorText id={`${fid("agentName")}-error`} message={errors.agentName} />
            <p className="mt-1 text-[13px] text-ink/70">We will ask for the person&rsquo;s signed permission and may contact them directly.</p>
          </div>
        ) : null}
      </div>

      <div>
        <label htmlFor={fid("details")} className="field-label">
          Details{type === "correction" ? <span className="text-accent"> *</span> : " (optional)"}
        </label>
        <textarea id={fid("details")} className="field min-h-24" maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} {...err("details")} />
        <ErrorText id={`${fid("details")}-error`} message={errors.details} />
        <p className="mt-1 text-[13px] text-ink/70">Please do not include Social Security numbers or account numbers.</p>
      </div>

      <div>
        <label className="flex min-h-11 items-start gap-3 text-[15px]">
          <input id={fid("attest")} type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" {...err("attest")} />
          <span>
            I confirm this request is about me, or that I am authorized to make it for the person named.<span className="text-accent"> *</span>
          </span>
        </label>
        <ErrorText id={`${fid("attest")}-error`} message={errors.attest} />
      </div>

      <div ref={statusRef} tabIndex={-1} aria-live="assertive" className="outline-none">
        {status.kind === "error" ? <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] font-medium text-red-800">{status.message}</p> : null}
      </div>

      <NoticeAtCollection point="privacy_request" />

      <TurnstileSlot turnstile={turnstile} />

      <button type="submit" className="pill pill-primary" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
