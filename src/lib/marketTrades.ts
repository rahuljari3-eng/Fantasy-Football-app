// Real accepted redraft trades (recorded by scripts/recordMarketTrades.ts)
// as a yardstick for the trade-value model: both managers said yes to every
// one, so a well-calibrated valuation should call the typical trade close
// to even. scripts/fitTradeValue.ts scores and tunes the model against them.
import type { Player } from "../types.js";

export interface MarketTradePlayer {
  name: string;
  pos: string;
  espnId: number | null;
}

export interface MarketTrade {
  id: string;
  date: string;
  numTeams: number;
  side1: MarketTradePlayer[];
  side2: MarketTradePlayer[];
}

export interface MarketTradeHistory {
  trades: MarketTrade[];
}

export interface ResolvedMarketTrade {
  trade: MarketTrade;
  side1: Player[];
  side2: Player[];
}

/** Trades whose every player is a priceable QB/RB/WR/TE in `pool` (no
 * draft picks, kickers, defenses, or players we can't find). */
export function resolveMarketTrades(trades: MarketTrade[], pool: Player[]): ResolvedMarketTrade[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const out: ResolvedMarketTrade[] = [];
  for (const trade of trades) {
    const resolve = (side: MarketTradePlayer[]) => side.map((p) => (p.espnId != null ? byId.get(p.espnId) : undefined));
    const s1 = resolve(trade.side1);
    const s2 = resolve(trade.side2);
    if (!s1.length || !s2.length) continue;
    if ([...s1, ...s2].some((p) => !p || !["QB", "RB", "WR", "TE"].includes(p.pos))) continue;
    out.push({ trade, side1: s1 as Player[], side2: s2 as Player[] });
  }
  return out;
}

/** How far a set of accepted trades lands from "even" under a side-value
 * function: the median and mean of |log(side2 / side1)|. 0 = every trade
 * priced dead even; 0.1 ≈ a typical 10% lean. */
export function marketTradeError(trades: ResolvedMarketTrade[], sideValue: (players: Player[]) => number): { median: number; mean: number; n: number } {
  const errs = trades
    .map(({ side1, side2 }) => {
      const a = sideValue(side1);
      const b = sideValue(side2);
      return a > 0 && b > 0 ? Math.abs(Math.log(b / a)) : Infinity;
    })
    .map((e) => Math.min(e, Math.log(4)))
    .sort((x, y) => x - y);
  const n = errs.length;
  return { median: n ? errs[Math.floor(n / 2)] : 0, mean: n ? errs.reduce((s, e) => s + e, 0) / n : 0, n };
}
