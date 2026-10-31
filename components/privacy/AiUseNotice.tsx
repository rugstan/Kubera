// Short AI-use notice for every place a person meets an AI feature: Kubera AI
// (the ⌘K command bar), the deal qualifier, and the document vault. No hooks,
// so server and client components can render it. The full explanation and
// the opt-out live at /privacy/ai.
//
// California's bot disclosure law (B&P §17941) asks that an automated chat
// identify itself; the "chat" variant leads with that.

export type AiUseContext = "chat" | "qualifier" | "documents";

const COPY: Record<AiUseContext, string> = {
  chat: "Kubera AI is an AI assistant, not a person. Its answers are general information, not a loan offer, a credit decision, or legal advice, and a licensed advisor reviews every engagement before anything goes to a lender. Please do not enter Social Security numbers, account numbers, or other sensitive details.",
  qualifier:
    "We use automated tools, including AI, to estimate which programs may fit your request. They help a licensed advisor; they do not make credit decisions. Lenders make all credit decisions.",
  documents:
    "We may use AI tools to read figures from the files you upload so an advisor can review them faster. Files are never used to train AI models, and sensitive numbers in them are not sent to AI tools for anything else.",
};

export const AI_NOTICE_HREF = "/privacy/ai";

export function AiUseNotice({ context, className = "", newTab = true }: { context: AiUseContext; className?: string; newTab?: boolean }) {
  const linkProps = newTab ? { target: "_blank", rel: "noopener" } : {};
  return (
    <div role="note" aria-label="How we use AI" data-ai-use-notice={context} className={`text-[12px] leading-relaxed text-ink/70 ${className}`}>
      <p>
        <span className="font-semibold text-ink">How we use AI.</span> {COPY[context]}{" "}
        <a href={AI_NOTICE_HREF} {...linkProps} className="font-medium text-accent underline underline-offset-2">
          Learn more or ask for advisor-only handling{newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
        </a>
        .
      </p>
    </div>
  );
}

export function aiUseNoticeText(context: AiUseContext): string {
  return COPY[context];
}
