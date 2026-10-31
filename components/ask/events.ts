// Tiny event bus so any component (sizer, hero, header) can open the command bar.
export type OpenCommandBarDetail = {
  prompt?: string;
  mode?: "chat" | "term_sheet";
  dealContext?: string;
  autoSubmit?: boolean;
};

export const OPEN_EVENT = "kubera:open-ask";

export function openCommandBar(detail: OpenCommandBarDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenCommandBarDetail>(OPEN_EVENT, { detail }));
}
