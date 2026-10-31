// Disclosure lifecycle: required → generated → sent → signed, with
// held_for_counsel reachable from any unsigned state and superseded when the
// terms change after signature (a new disclosure row is then opened).

export const disclosureStatuses = ["required", "generated", "sent", "signed", "held_for_counsel", "superseded"] as const;
export type DisclosureStatus = (typeof disclosureStatuses)[number];

export const disclosureKinds = ["MLDS_RE882", "FUNDER_DISCLOSURE"] as const;
export type DisclosureKind = (typeof disclosureKinds)[number];

export type DisclosureTransition =
  | "generate" // render the document from validated data
  | "regenerate" // terms changed before sending; re-render
  | "send" // delivered to the e-sign provider (after approval)
  | "complete" // every signer signed; provider reports completion
  | "void" // provider reports declined / expired / recalled; must be re-sent
  | "hold" // counsel hold
  | "release" // counsel cleared the hold
  | "supersede"; // signed, then terms changed

const TABLE: Record<DisclosureStatus, Partial<Record<DisclosureTransition, DisclosureStatus>>> = {
  required: { generate: "generated", hold: "held_for_counsel" },
  generated: { regenerate: "generated", send: "sent", hold: "held_for_counsel" },
  // A sent request is changed only by the provider (complete / void) or a counsel hold;
  // to change terms, recall it in the provider and regenerate after the void webhook.
  sent: { complete: "signed", void: "generated", hold: "held_for_counsel" },
  signed: { supersede: "superseded" },
  held_for_counsel: { release: "required" },
  superseded: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: DisclosureStatus,
    readonly transition: DisclosureTransition,
  ) {
    super(`Cannot ${transition} a disclosure in status ${from}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: DisclosureStatus, transition: DisclosureTransition): boolean {
  return TABLE[from][transition] !== undefined;
}

export function nextStatus(from: DisclosureStatus, transition: DisclosureTransition): DisclosureStatus {
  const to = TABLE[from][transition];
  if (!to) throw new InvalidTransitionError(from, transition);
  return to;
}

export function isTerminal(status: DisclosureStatus): boolean {
  return Object.keys(TABLE[status]).length === 0;
}
