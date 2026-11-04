import { categoriesSentence, COLLECTION_POINTS, type CollectionPoint } from "./legal";

// CCPA notice at collection (Civ. Code §1798.100(a); 11 CCR §7012). Render it at
// or before the point where a form collects personal information. It has no
// hooks, so both server and client components can render it.
//
// The privacy link opens in a new tab so a multi-step form keeps its state.

export function NoticeAtCollection({ point, className = "" }: { point: CollectionPoint; className?: string }) {
  const { purpose, retention = "generally three years after our last contact" } = COLLECTION_POINTS[point];
  return (
    <div role="note" aria-label="Notice at collection" data-notice-at-collection={point} className={`text-[12px] leading-relaxed text-ink/70 ${className}`}>
      <p>
        <span className="font-semibold text-ink">Notice at collection.</span> We collect {categoriesSentence(point)} {purpose}.
        {point === "upload" && " Your files may contain sensitive personal information, such as account numbers; we use it only to provide the services you ask for."}{" "}
        We do not sell your personal information or share it for cross-context behavioral advertising. We keep it only as long as our{" "}
        <a href="/privacy#retention" target="_blank" rel="noopener" className="font-medium text-accent underline underline-offset-2">
          retention schedule<span className="sr-only"> (opens in a new tab)</span>
        </a>{" "}
        allows, {retention}.{" "}
        <a href="/privacy#notice-at-collection" target="_blank" rel="noopener" className="font-medium text-accent underline underline-offset-2">
          Read the full notice and your California privacy rights<span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    </div>
  );
}
