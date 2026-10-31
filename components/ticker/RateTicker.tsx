import { getMarketSnapshot, type TickerItem } from "@/lib/rates";
import { TickerMarquee } from "./TickerMarquee";

function Item({ item }: { item: TickerItem }) {
  const change = item.changeBps;
  return (
    <li className="flex shrink-0 items-center gap-2 px-5">
      <span className="text-white/70">{item.label}</span>
      <span className="font-medium tabular-nums text-white">{item.value}</span>
      {change !== undefined && change !== 0 && (
        <span className={`tabular-nums ${change < 0 ? "text-emerald-400" : "text-rose-300"}`}>
          <span aria-hidden>{change < 0 ? "▼" : "▲"}</span>
          <span className="sr-only">{change < 0 ? "down " : "up "}</span>
          {Math.abs(change)}bp
        </span>
      )}
      {item.derived && <span className="text-xs uppercase tracking-wider text-white/60">est.</span>}
    </li>
  );
}

export async function RateTicker() {
  const snap = await getMarketSnapshot();
  return (
    <div className="relative z-50 h-9 overflow-hidden bg-black text-xs">
      <div className="flex h-full items-center">
        <div className="z-10 flex h-full shrink-0 items-center gap-2 bg-black pl-4 pr-3 font-medium text-white">
          <span className={`size-1.5 rounded-full ${snap.live ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
          <span className="hidden sm:inline">{snap.live ? "Live" : "Indicative"}</span>
          <span className="tabular-nums text-white/70">{snap.asOf}</span>
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
  return <div className="h-9 bg-black" aria-hidden />;
}
