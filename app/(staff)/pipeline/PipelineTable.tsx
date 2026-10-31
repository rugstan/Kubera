"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type FilterFn,
  type SortingState,
} from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DEAL_STAGES, MLDS_LABELS, formatUsd, isOpenDeal, matchesQuery, stageLabel, stageOrder, type PipelineRow } from "./model";

const col = createColumnHelper<PipelineRow>();

const globalMatch: FilterFn<PipelineRow> = (row, _id, value) => matchesQuery(row.original, String(value ?? ""));

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

function MldsBadge({ status }: { status: PipelineRow["mldsStatus"] }) {
  if (!status) return <span className="text-titanium">—</span>;
  const tone = status === "signed" ? "badge-emerald" : status === "held_for_counsel" ? "border border-red-700/30 bg-red-50 text-red-800" : "badge-gold";
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tone}`}>{MLDS_LABELS[status]}</span>;
}

const columns = [
  col.accessor("name", {
    header: "Deal",
    cell: (info) => (
      <Link href={`/deals/${info.row.original.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  col.accessor("program", { header: "Program", cell: (i) => i.getValue() ?? "—" }),
  col.accessor("stage", {
    header: "Stage",
    sortingFn: (a, b) => stageOrder(a.original.stage) - stageOrder(b.original.stage),
    cell: (i) => stageLabel(i.getValue()),
    filterFn: (row, _id, value) => !value || row.original.stage === value,
  }),
  col.accessor("loanAmountUsd", {
    header: "Loan",
    sortingFn: (a, b) => (a.original.loanAmountUsd ?? -1) - (b.original.loanAmountUsd ?? -1),
    cell: (i) => <span className="tabular-nums">{formatUsd(i.getValue())}</span>,
  }),
  col.accessor("location", { header: "Location", cell: (i) => i.getValue() ?? "—" }),
  col.accessor("ownerName", { header: "Owner", cell: (i) => i.getValue() ?? <span className="text-titanium">Unassigned</span> }),
  col.accessor("mldsStatus", { header: "MLDS", enableSorting: false, cell: (i) => <MldsBadge status={i.getValue()} /> }),
  col.accessor("pendingApprovals", {
    header: "Approvals",
    cell: (i) =>
      i.getValue() > 0 ? (
        <Link href="/approvals" className="font-medium text-accent underline underline-offset-2">
          {i.getValue()} pending
        </Link>
      ) : (
        <span className="text-titanium">None</span>
      ),
  }),
  col.accessor("updatedAt", {
    header: "Updated",
    sortingFn: (a, b) => Date.parse(a.original.updatedAt) - Date.parse(b.original.updatedAt),
    cell: (i) => <time dateTime={i.getValue()}>{dateFmt.format(new Date(i.getValue()))}</time>,
  }),
];

export function PipelineTable({ rows }: { rows: PipelineRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const data = useMemo(() => (showClosed ? rows : rows.filter(isOpenDeal)), [rows, showClosed]);
  const columnFilters = useMemo(() => (stage ? [{ id: "stage", value: stage }] : []), [stage]);

  // TanStack Table returns non-memoizable functions by design; the React Compiler lint knows.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: query, columnFilters },
    onSortingChange: setSorting,
    globalFilterFn: globalMatch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const visible = table.getFilteredRowModel().rows.length;

  return (
    <div className="bento overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-hairline p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="pipeline-search" className="field-label">
            Search deals
          </label>
          <input id="pipeline-search" type="search" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, program, owner, city" />
        </div>
        <div>
          <label htmlFor="pipeline-stage" className="field-label">
            Stage
          </label>
          <select id="pipeline-stage" className="field" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {DEAL_STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          Include closed and lost
        </label>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {visible} {visible === 1 ? "deal" : "deals"} shown
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Deal pipeline. Select a column heading to sort.</caption>
          <thead className="bg-canvas text-[12px] uppercase tracking-wide text-titanium">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" className="px-4 py-3 font-semibold" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 rounded uppercase tracking-wide">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span aria-hidden="true">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-hairline align-top hover:bg-black/[0.02]">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {visible === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-titanium">
                  No deals match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-hairline p-4 text-[14px]">
          <span className="text-titanium">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <button type="button" className="pill pill-glass min-h-11 px-4 py-2 text-[14px]" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </button>
            <button type="button" className="pill pill-glass min-h-11 px-4 py-2 text-[14px]" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
