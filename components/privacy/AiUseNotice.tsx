// Short notice for every place a person's request or files meet our automated
// tools: the deal qualifier and the document vault. No hooks, so server and
// client components can render it. The full explanation and the advisor-only
// option live at /privacy#automated-tools.
//
// The component and export names keep their original spelling because other
// files import them; the wording shown to people is what matters here.

export type AiUseContext = "qualifier" | "documents";

const COPY: Record<AiUseContext, string> = {
  qualifier:
    "We use automated tools to estimate which programs may fit your request and how soon an advisor should follow up. A licensed advisor reviews every request, and lenders make all credit decisions.",
  documents:
    "We may use automated tools to read figures from the files you upload so an advisor can check them faster. Our service providers may not use your files to train their products, and sensitive numbers in them are not used for anything else.",
};

export const AI_NOTICE_HREF = "/privacy#automated-tools";

export function AiUseNotice({ context, className = "", newTab = true }: { context: AiUseContext; className?: string; newTab?: boolean }) {
  const linkProps = newTab ? { target: "_blank", rel: "noopener" } : {};
  return (
    <div role="note" aria-label="How we use automated tools" data-automated-tools-notice={context} className={`text-[12px] leading-relaxed text-ink/70 ${className}`}>
      <p>
        <span className="font-semibold text-ink">How we use automated tools.</span> {COPY[context]}{" "}
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
