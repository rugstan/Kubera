import { Fragment, type ReactNode } from "react";

// A deliberately small Markdown renderer for streamed advisor answers:
// headings, lists, tables, code fences, bold/italic/code. It builds React
// nodes directly (never innerHTML), so model output can't inject markup.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-black/[0.05] px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key++} className="overflow-x-auto rounded-xl bg-black/[0.04] p-3 text-xs">{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level <= 2 ? "mt-5 text-lg font-semibold" : "mt-4 text-[15px] font-semibold";
      blocks.push(<p key={key++} className={`${cls} text-ink first:mt-0`}>{inline(h[2]!)}</p>);
      i++;
      continue;
    }
    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        const r = cells(lines[i]!);
        if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto rounded-xl border border-black/[0.06]">
          <table className="w-full text-left text-[13px]">
            {head && (
              <thead className="bg-black/[0.03]">
                <tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold">{inline(c)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-t border-black/[0.05]">
                  {r.map((c, j) => <td key={j} className="px-3 py-2 tabular-nums">{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-titanium`}>
          {items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </List>,
      );
      continue;
    }
    if (line.trim() === "" || /^-{3,}$/.test(line.trim())) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i]!) && !isTableRow(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={key++} className="my-2">{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div className="text-[15px] leading-relaxed text-ink/85">{blocks}</div>;
}
