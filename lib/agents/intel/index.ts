// Market intel & prospecting (WS-S). Public surface for the staff app and the
// workflow registration. Server wiring is in ./runtime.ts (server-only).

export * from "./types";
export { collectSignals, weekStartOf, addDays, FederalRegisterSource, FeedSource, RatesSignalSource, StaticSignalSource, parseFeed, scrubSignal, type SignalSourceClient } from "./signals";
export { runMarketIntel, rulesDigest, checkModelNote, marketPrompt, publicSignalPayload, MarketIntelError, type MarketDeps, type MarketRunResult } from "./market";
export { MemoryIntelStore, IntelStoreError, type IntelStore } from "./intel-store";
export { scoreProspect, recommendProgram, windowBucket, monthsUntil, DEFAULT_MARKET_RATE_PCT } from "./score";
export { AttomMaturityClient, FakeMaturityProvider, maturityProviderFromEnv, parseAttomMaturity, type MaturityProvider, type MaturityQuery } from "./maturity";
export { scanProspects, suppressProspect, addSuppressionValue, dedupeKeyOf, validateQuery, ProspectingError, type ScanResult } from "./prospects";
export { MemoryProspectStore, ProspectStoreError, type ProspectStore } from "./prospect-store";
export { draftOutreach, settleOutreach, settlePending, markMailed, cancelOutreach, buildMessage, lintOutreach, OutreachError, type OutreachDeps, type SenderIdentity } from "./outreach";
export { suppressionHash, suppressionKeys, isSuppressed, maskLabel } from "./suppression";
export { weeklyIntelWorkflow, prospectScanWorkflow, outreachSettleWorkflow, INTEL_EVENTS } from "./workflow";
