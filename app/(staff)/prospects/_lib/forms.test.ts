import { describe, expect, it } from "vitest";
import { FormInputError, channelFromForm, filterFromSearch, idOf, intelEditFromForm, parseZips, scanQueryFromForm, staffEditFromForm, suppressionSchema } from "./forms";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

describe("scanQueryFromForm", () => {
  it("parses ZIP codes in any separator, the window, types and the minimum loan", () => {
    const q = scanQueryFromForm(form({ zips: "90001, 91201\n92801  90001", fromMonths: "-3", toMonths: "12", propertyType: ["multifamily", "castle", "hotel"], minLoanAmount: "$1,500,000" }));
    expect(q).toEqual({ zips: ["90001", "91201", "92801"], fromMonths: -3, toMonths: 12, propertyTypes: ["multifamily", "hotel"], minLoanAmount: 1_500_000 });
  });
  it("defaults the window and leaves optional filters out", () => {
    expect(scanQueryFromForm(form({ zips: "90001" }))).toEqual({ zips: ["90001"], fromMonths: 0, toMonths: 18 });
  });
  it("rejects a non-numeric window", () => {
    expect(() => scanQueryFromForm(form({ zips: "90001", toMonths: "soon" }))).toThrow(FormInputError);
  });
});

describe("filterFromSearch", () => {
  it("defaults to active prospects and ignores unknown values", () => {
    expect(filterFromSearch({})).toEqual({ status: "active", limit: 200 });
    expect(filterFromSearch({ status: "hacked", program: "x", window: "y", minScore: "abc" })).toEqual({ limit: 200 });
  });
  it("reads each known filter", () => {
    expect(filterFromSearch({ status: "drafted", program: "hud_223f", window: "months_6_12", minScore: "70.4", q: "  glendale " })).toEqual({ status: "drafted", program: "hud_223f", window: "months_6_12", minScore: 70, q: "glendale", limit: 200 });
    expect(filterFromSearch({ status: ["new", "drafted"], minScore: "500" })).toMatchObject({ status: "new", minScore: 100 });
  });
});

describe("small parsers", () => {
  it("parses ZIP lists", () => {
    expect(parseZips("90001;90002 , 90001")).toEqual(["90001", "90002"]);
    expect(parseZips("")).toEqual([]);
  });
  it("requires a uuid and a known channel", () => {
    expect(idOf(form({ id: "00000000-0000-4000-8000-000000000001" }))).toBe("00000000-0000-4000-8000-000000000001");
    expect(() => idOf(form({ id: "../../etc" }))).toThrow(FormInputError);
    expect(channelFromForm(form({ channel: "letter" }))).toBe("letter");
    expect(() => channelFromForm(form({ channel: "sms" }))).toThrow(/email or letter/);
  });
  it("turns blanks into nulls and ignores an unknown status", () => {
    expect(staffEditFromForm(form({ contactName: " ", contactEmail: "a@b.co", assignedTo: "", notes: "n", status: "bogus" }))).toEqual({ contactName: null, contactEmail: "a@b.co", assignedTo: null, notes: "n" });
    expect(staffEditFromForm(form({ status: "engaged" })).status).toBe("engaged");
  });
  it("validates suppression entries", () => {
    expect(suppressionSchema.safeParse({ kind: "email", value: "a@b.co", reason: "opt_out" }).success).toBe(true);
    expect(suppressionSchema.safeParse({ kind: "phone", value: "x", reason: "opt_out" }).success).toBe(false);
    expect(suppressionSchema.safeParse({ kind: "email", value: " ", reason: "opt_out" }).success).toBe(false);
  });
});

describe("intelEditFromForm", () => {
  const draft = { sections: [{ title: "Rates", bullets: [{ text: "a", signalIds: ["s1"] }, { text: "b", signalIds: ["s2"] }] }, { title: "HUD", bullets: [{ text: "c", signalIds: ["s3"] }] }] };

  it("keeps the stored structure and citations, and drops a bullet that was cleared", () => {
    const e = intelEditFromForm(form({ headline: "H", summary: "S", "section-0-title": "Rates and SOFR", "bullet-0-0": "a edited", "bullet-0-1": "", "bullet-1-0": "c" }), draft);
    expect(e).toEqual({ headline: "H", summary: "S", sections: [{ title: "Rates and SOFR", bullets: [{ text: "a edited", signalIds: ["s1"] }] }, { title: "HUD", bullets: [{ text: "c", signalIds: ["s3"] }] }] });
  });
  it("drops a section with no bullets left, and refuses an empty note", () => {
    const e = intelEditFromForm(form({ headline: "H", summary: "S", "bullet-0-0": "a", "bullet-0-1": "b" }), draft);
    expect(e.sections.map((s) => s.title)).toEqual(["Rates"]);
    expect(() => intelEditFromForm(form({ headline: "H", summary: "S" }), draft)).toThrow(/at least one bullet/);
    expect(() => intelEditFromForm(form({ headline: "", summary: "S" }), draft)).toThrow(/headline/);
  });
});
