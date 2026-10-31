import { getMarketSnapshot, type TickerItem } from "@/lib/rates";

function Item({ item }: { item: TickerItem }) {
  const change = item.changeBps;
  return (
    <li className="flex shrink-0 items-center gap-2 px-5">
      <span className="text-white/55">{item.label}</span>
      <span className="font-medium tabular-nums text-white">{item.value}</span>
      {change !== undefined && change !== 0 && (
        <span className={`tabular-nums ${change < 0 ? "text-emerald-400" : "text-rose-300"}`}>
          {change < 0 ? "▼" : "▲"}
          {Math.abs(change)}bp
        </span>
      )}
      {item.derived && <span className="text-[10px] uppercase tracking-wider text-white/35">est.</span>}
    </li>
  );
}

export async function RateTicker() {
  const snap = await getMarketSnapshot();
  return (
    <div className="relative z-50 h-9 overflow-hidden bg-black text-[12px]" aria-label="Capital markets rates">
      <div className="flex h-full items-center">
        <div className="z-10 flex h-full shrink-0 items-center gap-2 bg-black pl-4 pr-3 font-medium text-white">
          <span className={`size-1.5 rounded-full ${snap.live ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
          <span className="hidden sm:inline">{snap.live ? "Live" : "Indicative"}</span>
          <span className="text-white/40 tabular-nums">{snap.asOf}</span>
        </div>
        <div className="group relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)]">
          <ul className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none">
            {[...snap.items, ...snap.items].map((item, i) => (
              <Item key={`${item.key}-${i}`} item={item} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function RateTickerSkeleton() {
  return <div className="h-9 bg-black" aria-hidden />;
}
