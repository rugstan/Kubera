import { getMarketSnapshot, type TickerItem } from "@/lib/rates";
import { TickerMarquee } from "./TickerMarquee";

function Item({ item }: { item: TickerItem }) {
  const change = item.changeBps;
  return (
    <li className="flex shrink-0 items-center gap-2 px-5">
      <span className="text-titanium">{item.label}</span>
      <span className="font-medium tabular-nums text-ink">{item.value}</span>
      {change !== undefined && change !== 0 && (
        <span className="tabular-nums text-ink/70">
          <span aria-hidden>{change < 0 ? "▼" : "▲"}</span>
          <span className="sr-only">{change < 0 ? "down " : "up "}</span>
          {Math.abs(change)}bp
        </span>
      )}
      {item.derived && <span className="text-xs uppercase tracking-wider text-titanium">est.</span>}
    </li>
  );
}

export async function RateTicker() {
  const snap = await getMarketSnapshot();
  return (
    <div className="relative z-50 h-9 overflow-hidden border-b border-hairline bg-canvas text-xs text-ink">
      <div className="flex h-full items-center">
        <div className="z-10 flex h-full shrink-0 items-center gap-2 bg-canvas pl-4 pr-3 font-medium text-ink">
          <span className={`size-1.5 rounded-full ${snap.live ? "animate-pulse bg-accent-fill" : "bg-quiet"}`} aria-hidden />
          <span>{snap.live ? "Live" : "Indicative"}</span>
          <span className="tabular-nums text-titanium">
            <span className="sr-only">{snap.live ? "as of " : "fallback values set "}</span>
            {snap.asOf}
          </span>
        </div>
        <TickerMarquee
          label="Capital markets rates"
          primary={snap.items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
          duplicate={snap.items.map((item) => (
            <Item key={`${item.key}-dup`} item={item} />
          ))}
        />
      </div>
    </div>
  );
}

export function RateTickerSkeleton() {
  return <div className="h-9 border-b border-hairline bg-canvas" aria-hidden />;
}
