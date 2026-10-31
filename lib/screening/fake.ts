// In-memory sanctions list for tests and local development. Scores with the
// same name matcher the policy uses, so a test can put "Ivan Petrov" on the
// list and watch "Petrov, Ivan" hold the deal.

import { nameSimilarity } from "./match";
import { ScreeningUnavailableError, type SanctionsClient, type ScreeningMatch, type ScreeningResponse, type ScreeningSubject } from "./types";

export type FakeListEntry = { entryId: string; name: string; kind?: "individual" | "entity"; birthDates?: string[]; programs?: string[]; lists?: string[]; countries?: string[] };

export const FAKE_LIST_VERSION = "fake-sdn@2026-10-30";

export class FakeSanctionsClient implements SanctionsClient {
  readonly name = "fake";
  readonly calls: ScreeningSubject[] = [];
  failNext = false;

  constructor(
    private readonly entries: FakeListEntry[] = [],
    private readonly opts: { listVersion?: string; threshold?: number; now?: () => Date } = {},
  ) {}

  add(entry: FakeListEntry): void {
    this.entries.push(entry);
  }

  async screen(subject: ScreeningSubject): Promise<ScreeningResponse> {
    this.calls.push(subject);
    if (this.failNext) {
      this.failNext = false;
      throw new ScreeningUnavailableError("fake provider outage");
    }
    const threshold = this.opts.threshold ?? 0.5;
    const matches: ScreeningMatch[] = [];
    for (const e of this.entries) {
      if (e.kind && e.kind !== subject.kind) continue;
      let score = nameSimilarity(subject.name, e.name);
      // A conflicting birth date makes a person match much less likely; an equal one more likely.
      if (subject.dateOfBirth && e.birthDates?.length) score = e.birthDates.includes(subject.dateOfBirth) ? Math.min(1, score + 0.05) : score * 0.8;
      if (score < threshold) continue;
      matches.push({ entryId: e.entryId, name: e.name, score: Math.round(score * 1000) / 1000, lists: e.lists ?? ["us_ofac_sdn"], programs: e.programs ?? [], birthDates: e.birthDates ?? [], countries: e.countries ?? [], providerMatch: null });
    }
    return {
      provider: this.name,
      listVersion: this.opts.listVersion ?? FAKE_LIST_VERSION,
      listsChecked: ["us_ofac_sdn", "us_ofac_cons"],
      matches: matches.sort((a, b) => b.score - a.score),
      screenedAt: (this.opts.now?.() ?? new Date()).toISOString(),
    };
  }
}
