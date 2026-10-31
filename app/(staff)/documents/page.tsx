import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { listDocuments } from "./data";
import { DOCUMENT_KIND_LABELS, kindLabel, servable } from "./model";

export const metadata: Metadata = { title: "Documents" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">Vault</p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-ink">Documents</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">Borrower files from the private vault. Every open is logged, and links expire after a minute.</p>
        <p className="mt-2 flex flex-wrap gap-x-6 text-[14px]">
          <Link href="/documents/extractions" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
            Review extracted figures
          </Link>
          <Link href="/documents/mail" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
            Mail waiting for review
          </Link>
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading documents" />}>
        <DocumentList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DocumentList({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await requireStaff("/documents");
  const dealId = z.uuid().safeParse(sp.deal).data;
  const kind = typeof sp.kind === "string" && sp.kind in DOCUMENT_KIND_LABELS ? sp.kind : undefined;
  const docs = await listDocuments(ctx, { dealId, kind });

  return (
    <div className="bento overflow-hidden">
      <form className="flex flex-wrap items-end gap-3 border-b border-hairline p-4" action="/documents">
        {dealId ? <input type="hidden" name="deal" value={dealId} /> : null}
        <div>
          <label htmlFor="doc-kind" className="field-label">
            Type
          </label>
          <select id="doc-kind" name="kind" defaultValue={kind ?? ""} className="field">
            <option value="">All types</option>
            {Object.entries(DOCUMENT_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]">
          Filter
        </button>
        {dealId || kind ? (
          <Link href="/documents" className="inline-flex min-h-11 items-center text-[14px] text-accent underline underline-offset-2">
            Clear filters
          </Link>
        ) : null}
      </form>
      {docs.length === 0 ? (
        <p className="p-10 text-center text-titanium">No documents match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Documents in the vault</caption>
            <thead className="bg-canvas text-[12px] uppercase tracking-wide text-titanium">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">File</th>
                <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                <th scope="col" className="px-4 py-3 font-semibold">Deal</th>
                <th scope="col" className="px-4 py-3 font-semibold">Received</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const s = servable(d);
                return (
                  <tr key={d.id} className="border-t border-hairline">
                    <td className="px-4 py-3">
                      <Link href={`/documents/${d.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                        {d.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{kindLabel(d.kind)}</td>
                    <td className="px-4 py-3">
                      {d.dealId ? (
                        <Link href={`/documents?deal=${d.dealId}`} className="text-accent underline underline-offset-2">
                          {d.dealName}
                        </Link>
                      ) : (
                        <span className="text-titanium">Lead only</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <time dateTime={d.createdAt}>{dateFmt.format(new Date(d.createdAt))}</time>
                    </td>
                    <td className="px-4 py-3">
                      {s.ok ? <span className="text-titanium">Available</span> : <span className="font-medium text-red-800">Quarantined</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
