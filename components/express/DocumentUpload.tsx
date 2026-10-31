"use client";

import { useState } from "react";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { AiUseNotice } from "@/components/privacy/AiUseNotice";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";

const KINDS = [
  { value: "T12", label: "T-12 P&L" },
  { value: "RENT_ROLL", label: "Rent roll" },
  { value: "CENSUS", label: "Census report" },
  { value: "STR_REPORT", label: "STR report" },
  { value: "FRANCHISE_AGREEMENT", label: "Franchise agreement" },
  { value: "PIP_BUDGET", label: "PIP budget" },
  { value: "PFS", label: "Personal financial statement" },
  { value: "OTHER", label: "Other" },
];

const MAX_BYTES = 50 * 1024 * 1024;

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** The declared type must match the file's bytes at finalize, so fall back to the extension, not a guess. */
function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[ext] ?? "application/octet-stream";
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

export function DocumentUpload({ leadId, token }: { leadId: string; token: string }) {
  const [kind, setKind] = useState("T12");
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const turnstile = useTurnstile("documents");

  async function upload(file: File) {
    if (file.size > MAX_BYTES) return setStatus(`${file.name} is larger than 50 MB. Split it into smaller files or email it to your advisor.`);
    const retry = `We couldn't upload ${file.name}. Please try again.`;
    setStatus(`Uploading ${file.name}…`);
    try {
      // Step 1: record the upload and get a signed quarantine URL plus an upload token.
      // Turnstile tokens are single use: mint a fresh one for every file.
      const captcha = await turnstile.getToken();
      const start = await postJson(
        "/api/documents",
        { leadId, token, kind, fileName: file.name, contentType: contentTypeOf(file), sizeBytes: file.size },
        turnstileHeaders(captcha),
      );
      if (!start.ok || typeof start.data.uploadUrl !== "string") throw new Error(errorOf(start.data, retry));

      // Step 2: send the file straight to the private quarantine bucket.
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(start.data.uploadUrl, { method: "PUT", body: form });
      if (!put.ok) throw new Error(retry);

      // Step 3: finalize, so the server checks size, file type and quota now and
      // queues the malware scan. Only a finalized file counts as uploaded.
      const done = await postJson("/api/documents/finalize", { documentId: start.data.documentId, token: start.data.uploadToken });
      const finalStatus = done.data.status;
      if (!done.ok || (finalStatus !== "quarantined" && finalStatus !== "clean")) throw new Error(errorOf(done.data, retry));

      setUploaded((u) => [...u, `${KINDS.find((k) => k.value === kind)?.label}: ${file.name}`]);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof TypeError ? `Network error. ${retry}` : (e as Error).message);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <NoticeAtCollection point="upload" />
      <AiUseNotice context="documents" />
      <TurnstileSlot turnstile={turnstile} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="field sm:w-56" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        {/* The input is sr-only, so the label draws the focus ring (see .pill:has(> input:focus-visible) in globals.css). */}
        <label className="pill pill-glass cursor-pointer !py-2.5 !text-[15px]">
          Choose file
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.csv,.xls,.xlsx,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {status && <p className="text-sm text-titanium" role="status">{status}</p>}
      {uploaded.length > 0 && (
        <ul className="space-y-1 text-sm">
          {uploaded.map((u) => <li key={u} className="flex items-center gap-2"><span className="text-accent">✓</span>{u}</li>)}
        </ul>
      )}
    </div>
  );
}
