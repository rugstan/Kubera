import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { getDocument } from "../data";
import { kindLabel, servable, SIGNED_URL_TTL_SECONDS } from "../model";

export const metadata: Metadata = { title: "Document" };

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <Link href="/documents" className="text-[14px] text-accent underline underline-offset-2">
        All documents
      </Link>
      <Suspense fallback={<div className="bento mt-4 h-64 animate-pulse" aria-label="Loading document" />}>
        <DocumentDetail params={params} />
      </Suspense>
    </>
  );
}

async function DocumentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = z.uuid().safeParse(raw);
  if (!id.success) notFound();
  const ctx = await requireStaff(`/documents/${id.data}`);
  const doc = await getDocument(ctx, id.data);
  if (!doc) notFound();
  const s = servable(doc);

  return (
    <article className="bento mt-4 p-7">
      <p className="eyebrow">{kindLabel(doc.kind)}</p>
      <h1 className="mt-1 break-words font-display text-[28px] font-semibold text-ink">{doc.fileName}</h1>
      <dl className="mt-6 grid gap-x-8 gap-y-4 text-[15px] sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-titanium">Deal</dt>
          <dd>{doc.dealName ?? "Not linked to a deal yet"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-titanium">Received</dt>
          <dd>
            <time dateTime={doc.createdAt}>{dateFmt.format(new Date(doc.createdAt))}</time>
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-titanium">File type</dt>
          <dd>{doc.contentType}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-titanium">Scan status</dt>
          <dd>{doc.scanStatus ?? "Not recorded"}</dd>
        </div>
      </dl>
      {s.ok ? (
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={`/documents/${doc.id}/file`} target="_blank" rel="noopener noreferrer" className="pill pill-primary">
            Open document
          </a>
          <a href={`/documents/${doc.id}/file?download=1`} className="pill pill-glass">
            Download
          </a>
        </div>
      ) : (
        <p role="status" className="notice-danger mt-7 rounded-xl px-4 py-3 text-[14px]">
          {s.message}
        </p>
      )}
      <p className="mt-5 text-[13px] text-titanium">
        Opening or downloading records your name and the time in the staff audit log. The link expires {SIGNED_URL_TTL_SECONDS} seconds after it is issued.
        Borrower files are confidential: do not forward them outside the deal team.
      </p>
    </article>
  );
}
