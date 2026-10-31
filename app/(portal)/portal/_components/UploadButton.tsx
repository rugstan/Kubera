"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

// Uploads one file for a checklist item: ask the server for a signed upload
// URL, send the file straight to the vault's quarantine bucket, then confirm
// so the server can check the file and queue it for the malware scan. The
// item is received once the scan passes.

const ACCEPT = ".pdf,.csv,.xls,.xlsx,.png,.jpg,.jpeg,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg";
const MAX = 50 * 1024 * 1024;

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", csv: "text/csv", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function UploadButton({ itemId, itemTitle }: { itemId: string; itemTitle: string }) {
  const id = useId();
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function upload(file: File) {
    const contentType = contentTypeOf(file);
    if (file.size > MAX) return setState({ kind: "error", message: "Files can be up to 50 MB. Split it or email it to your advisor." });
    setState({ kind: "busy", message: `Uploading ${file.name}…` });
    try {
      const start = await postJson("/portal/api/uploads", { itemId, fileName: file.name, contentType, sizeBytes: file.size });
      if (!start.ok) return setState({ kind: "error", message: String(start.data.error ?? "We couldn't start the upload.") });
      const put = await fetch(String(start.data.uploadUrl), { method: "PUT", headers: { "content-type": contentType, "x-upsert": "false" }, body: file });
      if (!put.ok) return setState({ kind: "error", message: "The upload did not finish. Check your connection and try again." });
      const done = await postJson("/portal/api/uploads/complete", { fileId: start.data.fileId });
      if (!done.ok) return setState({ kind: "error", message: String(done.data.error ?? "We couldn't confirm the upload.") });
      const scanning = (done.data.file as { status?: string } | undefined)?.status === "scanning";
      setState({ kind: "done", message: scanning ? `${file.name} uploaded. We are checking it for viruses; it goes to your advisor once the check passes.` : `${file.name} received. Your advisor will review it.` });
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Network error. Nothing was uploaded; please try again." });
    }
  }

  return (
    <div>
      <label htmlFor={id} className={`pill pill-glass !px-4 !py-2 !text-[15px] cursor-pointer ${state.kind === "busy" ? "pointer-events-none opacity-60" : ""}`}>
        {state.kind === "busy" ? "Uploading…" : "Upload file"}
        <span className="sr-only"> for {itemTitle}</span>
        <input
          id={id}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={state.kind === "busy"}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void upload(f);
          }}
        />
      </label>
      <p aria-live="polite" className={`mt-2 text-[13px] ${state.kind === "error" ? "text-red-900" : "text-ink/80"}`}>
        {state.message ?? ""}
      </p>
    </div>
  );
}
