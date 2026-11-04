// CRM agents (WS-N): Twenty automation behind the approval gate.
//
//   stage updates from deal events   ./stage-sync.ts   crmStageSink, syncDealStage, reconcileStages
//   notes from emails and calls      ./notes.ts, ./call-notes.ts, ./handlers.ts
//   tasks for brokers                ./tasks.ts
//   dedupe companies                 ./dedupe.ts, ./handlers.ts runDedupeScan
//   least-privilege tool scopes      ./scopes.ts
//   every write logged               ./events.ts (agent_events)
//   approvals                        ./writer.ts, ./policy.ts, ./executor.ts
//
// Server wiring (server-only) is ./server.ts; import it directly, not from here.

export * from "./call-notes";
export * from "./dedupe";
export * from "./events";
export * from "./executor";
export * from "./fake-client";
export * from "./handlers";
export * from "./links";
export * from "./mail-source";
export * from "./notes";
export * from "./operations";
export * from "./policy";
export * from "./scopes";
export * from "./stage-map";
export * from "./stage-sync";
export * from "./tasks";
export * from "./twenty-client";
export * from "./types";
export * from "./writer";
