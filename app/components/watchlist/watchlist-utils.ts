import { SYMBOLS, type Symbol } from "@/app/lib/symbols";

// Curated symbols not already in the user's watchlist — the addable set for
// the "add symbol" control. Pulled out as a pure function per this repo's
// no-jsdom convention (component tests aren't feasible here; logic that can
// be tested standalone should be, keeping Watchlist.tsx itself thin).
export function getAddableSymbols(currentSymbols: readonly string[]): Symbol[] {
  const current = new Set(currentSymbols);
  return SYMBOLS.filter((symbol) => !current.has(symbol));
}
