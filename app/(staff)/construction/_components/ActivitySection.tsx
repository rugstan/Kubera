import type { ConstructionEvent } from "@/lib/construction/types";
import { Card, formatDateTime } from "./ui";

export function ActivitySection({ events }: { events: ConstructionEvent[] }) {
  return (
    <Card id="activity" title="Activity" lead="An append-only record of every change on this project.">
      {events.length === 0 ? (
        <p className="text-[15px] text-titanium">Nothing yet.</p>
      ) : (
        <ol className="divide-y divide-black/10 text-[14px]">
          {[...events].reverse().map((e, i) => (
            <li key={`${e.occurredAt}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">{e.eventType.replaceAll("_", " ")}</span>
              <span className="text-titanium">
                {e.actor} · {formatDateTime(e.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
