// State shape returned by the construction desk's server actions.
export type ActionState = {
  ok: boolean;
  message: string | null;
  fieldErrors: Record<string, string>;
  /** Submitted text values, echoed back after a failure so the form keeps what the user typed. */
  values: Record<string, string>;
};

export const initialActionState: ActionState = { ok: false, message: null, fieldErrors: {}, values: {} };
