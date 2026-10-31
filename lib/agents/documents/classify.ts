// Document-type classifier for files whose vault kind is OTHER (or mail
// attachments). Keyword hits plus whether a row header for the type can be
// found. Low-margin results are reported with low confidence so the pipeline
// sends them to review instead of guessing.

import { findHeader } from "./rules";
import { DOC_SPECS } from "./specs";
import { DOC_TYPES, type DocType, type ParsedSource } from "./types";
import { normalizeLabel } from "./values";

export type Classification = { docType: DocType | null; confidence: number; scores: Record<DocType, number> };

export function classifyDocument(parsed: ParsedSource, fileName = ""): Classification {
  const haystack = ` ${normalizeLabel(`${fileName} ${parsed.text.slice(0, 40_000)}`)} `;
  const scores = {} as Record<DocType, number>;
  for (const docType of DOC_TYPES) {
    const spec = DOC_SPECS[docType];
    let score = 0;
    for (const kw of spec.keywords) {
      const k = normalizeLabel(kw);
      if (!k) continue;
      if (haystack.includes(` ${k} `)) score += k.includes(" ") ? 2 : 1;
    }
    if (spec.rows && findHeader(spec.rows, parsed.tables)) score += 4;
    scores[docType] = score;
  }
  const ranked = [...DOC_TYPES].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0]!;
  const second = ranked[1]!;
  if (scores[top] < 3) return { docType: null, confidence: 0, scores };
  const margin = (scores[top] - scores[second]) / scores[top];
  return { docType: top, confidence: Math.round(Math.min(0.95, 0.5 + margin * 0.5) * 1000) / 1000, scores };
}
