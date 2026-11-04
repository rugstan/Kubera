import { describe, expect, it } from "vitest";
import { comparePair, editDistance, entityType, findDuplicates, normalizeAddress, normalizeCompanyName } from "./dedupe";
import type { CrmCompany } from "./types";

const co = (id: string, name: string, over: Partial<CrmCompany> = {}): CrmCompany => ({ id, name, domain: null, address: null, createdAt: "2026-01-01T00:00:00Z", deleted: false, ...over });

describe("normalization", () => {
  it("drops legal suffixes, punctuation, case, accents and a leading 'The'", () => {
    expect(normalizeCompanyName("The Sunrise Senior Living, L.L.C.")).toBe("sunrise senior living");
    expect(normalizeCompanyName("SUNRISE SENIOR LIVING INC.")).toBe("sunrise senior living");
    expect(normalizeCompanyName("Café Rôtie & Sons Co")).toBe("cafe rotie and sons");
    expect(normalizeCompanyName("LLC")).toBe("llc");
  });

  it("reads the entity type", () => {
    expect(entityType("Oak Terrace LP")).toBe("lp");
    expect(entityType("Oak Terrace, L.L.C.")).toBe("llc");
    expect(entityType("Oak Terrace Incorporated")).toBe("inc");
    expect(entityType("Oak Terrace")).toBeNull();
  });

  it("normalizes street lines and ignores addresses without a number", () => {
    expect(normalizeAddress("100 North Main Street, Fresno, CA, 93721")).toBe("100 n main st");
    expect(normalizeAddress("100 N. Main St., Suite 4")).toBe("100 n main st");
    expect(normalizeAddress("Fresno, CA")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it("bounds edit distance", () => {
    expect(editDistance("sunrise senior living", "sunrise senior livng", 1)).toBe(1);
    expect(editDistance("abcdef", "uvwxyz", 1)).toBeGreaterThan(1);
  });
});

describe("comparePair", () => {
  it("scores independent evidence", () => {
    const a = co("1", "Sunrise Senior Living LLC", { domain: "sunriseliving.com", address: "100 Main St, Fresno, CA" });
    const b = co("2", "Sunrise Senior Living, LLC", { domain: "sunriseliving.com", address: "100 Main Street, Fresno, CA" });
    const v = comparePair(a, b);
    expect(v.reasons).toEqual(["same_name", "same_domain", "same_address"]);
    expect(v.score).toBe(1);
    expect(v.conflict).toBeNull();
  });

  it("never merges different websites or an LP with an LLC", () => {
    expect(comparePair(co("1", "Oak Terrace LLC", { domain: "a.com" }), co("2", "Oak Terrace LLC", { domain: "b.com" })).conflict).toBe("domain_conflict");
    expect(comparePair(co("1", "Oak Terrace LP"), co("2", "Oak Terrace LLC")).conflict).toBe("entity_type_conflict");
  });

  it("does not match on generic names", () => {
    expect(comparePair(co("1", "Self Employed"), co("2", "self-employed")).reasons).not.toContain("same_name");
    expect(comparePair(co("1", "TBD"), co("2", "TBD LLC")).score).toBe(0);
  });
});

describe("findDuplicates", () => {
  const companies: CrmCompany[] = [
    co("a", "Sunrise Senior Living LLC", { domain: "sunriseliving.com", createdAt: "2026-02-01T00:00:00Z" }),
    co("b", "Sunrise Senior Living, LLC", { domain: "sunriseliving.com", createdAt: "2026-01-01T00:00:00Z" }),
    co("c", "Harbor Inn Holdings", { domain: "harborinn.com" }),
    co("d", "Harbor Inn Holdings", { domain: "other.com" }),
    co("e", "Oak Terrace LP"),
    co("f", "Oak Terrace LLC"),
    co("g", "Maple Court Apartments"),
    co("h", "Maple Court Apartments"),
    co("i", "Pine Ridge Lodge", { domain: "pineridge.com", address: "9 Pine Rd, Reno, NV" }),
    co("j", "Pine Rdge Lodge", { domain: "pineridge.com", address: "9 Pine Road, Reno, NV" }),
    co("k", "Gone Co", { deleted: true }),
    co("l", "Gone Co"),
  ];

  it("proposes clear duplicates, oldest survives, and lists the rest as conflicts or review-only", () => {
    const scan = findDuplicates(companies);
    expect(scan.proposals.map((p) => [p.survivorId, p.duplicateId])).toEqual(
      expect.arrayContaining([
        ["b", "a"],
        ["i", "j"],
      ]),
    );
    expect(scan.proposals).toHaveLength(2);
    expect(scan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "domain_conflict" }), expect.objectContaining({ reason: "entity_type_conflict" })]));
    // Same name and nothing else: shown to staff, never proposed.
    expect(scan.reviewOnly).toEqual([{ a: "g", b: "h", reasons: ["same_name"] }]);
    expect(scan.proposals.find((p) => p.duplicateId === "h" || p.duplicateId === "d" || p.duplicateId === "f" || p.duplicateId === "l")).toBeUndefined();
  });

  it("keeps the company with the most linked records", () => {
    const scan = findDuplicates(companies, (id) => (id === "a" ? 9 : 0));
    expect(scan.proposals.find((p) => p.duplicateId === "b")).toMatchObject({ survivorId: "a" });
  });

  it("caps proposals and sorts by evidence", () => {
    const many = Array.from({ length: 10 }, (_, i) => [co(`x${i}a`, `Acme ${i} Holdings LLC`, { domain: `acme${i}.com` }), co(`x${i}b`, `Acme ${i} Holdings`, { domain: `acme${i}.com` })]).flat();
    const scan = findDuplicates(many, () => 0, { maxProposals: 3 });
    expect(scan.proposals).toHaveLength(3);
  });

  it("does not chain A~B~C into merging A with C on B's evidence alone", () => {
    const chain = [
      co("a", "Cedar Point Partners", { domain: "cedar.com" }),
      co("b", "Cedar Point Partners", { domain: "cedar.com", address: "5 Cedar Ln, Napa, CA" }),
      co("c", "Cedar Point Partner", { address: "5 Cedar Lane, Napa, CA" }),
    ];
    const scan = findDuplicates(chain);
    for (const p of scan.proposals) expect(comparePair(chain.find((x) => x.id === p.survivorId)!, chain.find((x) => x.id === p.duplicateId)!).score).toBeGreaterThanOrEqual(0.75);
  });
});
