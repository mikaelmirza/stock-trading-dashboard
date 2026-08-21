"use client";

import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/app/lib/decimal";
import type { MarketData } from "@/app/hooks/useMarketData";
import TradeForm from "./TradeForm";
import { computeUnrealizedPnL, holdingsEmptyMessage, type HoldingRow } from "./holdings-utils";

export interface Holding extends HoldingRow {
  id: string;
}

export async function fetchHoldings(): Promise<Holding[]> {
  const res = await fetch("/api/holdings");
  if (!res.ok) throw new Error(`holdings fetch failed: ${res.status}`);
  return res.json();
}

// PLAN step 34: positions + unrealized P&L (recalculated live as ticks
// arrive for whichever symbol is currently selected) plus the buy/sell
// form for that same symbol.
export default function HoldingsPanel({ marketData }: { marketData: MarketData }) {
  const { data: holdings = [], isPending } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
  });

  const emptyMessage = holdingsEmptyMessage(holdings.length, isPending);

  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        Holdings
      </Typography>

      {emptyMessage ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {emptyMessage}
        </Typography>
      ) : (
        <Table size="small" sx={{ mb: 2 }}>
          <TableBody>
            {holdings.map((holding) => {
              const livePrice = holding.symbol === marketData.symbol ? marketData.price : null;
              const { unrealizedPnL, unrealizedPnLPercent } = computeUnrealizedPnL(holding, livePrice);
              const isGain = unrealizedPnL !== null && Number(unrealizedPnL) >= 0;

              return (
                <TableRow key={holding.id}>
                  <TableCell>{holding.symbol}</TableCell>
                  <TableCell align="right">{holding.quantity}</TableCell>
                  <TableCell align="right">{formatMoney(holding.avgCostBasis)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: unrealizedPnL === null ? "text.secondary" : isGain ? "success.main" : "error.main",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {unrealizedPnL === null
                      ? "—"
                      : `${formatMoney(unrealizedPnL)} (${unrealizedPnLPercent}%)`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <TradeForm marketData={marketData} />
    </Box>
  );
}
