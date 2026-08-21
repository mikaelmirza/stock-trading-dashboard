"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/app/lib/decimal";
import type { MarketData } from "@/app/hooks/useMarketData";
import type { OrderBookLevel } from "@/app/hooks/market-stream";
import { useDashboardStore } from "@/app/store/dashboard-store";
import {
  FrameBatcher,
  asksTopDown,
  depthRatio,
  maxLevelSize,
  orderBookEmptyMessage,
} from "./orderbook-utils";

// PLAN step 31: live bid/ask ladder for the selected symbol, fed by
// useMarketData (26a). Rendering reads from `displayed` state, which a
// FrameBatcher only advances once per animation frame — the prop itself can
// change on every incoming tick, but that never drives a render directly,
// which is what keeps rapid ticks from re-rendering the table per message
// (SPEC §8).
export default function OrderBook({ marketData }: { marketData: MarketData }) {
  const [displayed, setDisplayed] = useState(marketData);
  const batcherRef = useRef<FrameBatcher<MarketData> | null>(null);

  useEffect(() => {
    const batcher = new FrameBatcher<MarketData>(marketData, setDisplayed);
    batcherRef.current = batcher;
    return () => batcher.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    batcherRef.current?.push(marketData);
  }, [marketData]);

  const { symbol, book } = displayed;
  const max = maxLevelSize(book);
  const connectionStatus = useDashboardStore((s) => s.connectionStatus);
  const emptyMessage = orderBookEmptyMessage(symbol, book, connectionStatus);

  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        Order Book
      </Typography>

      {book === null ? (
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      ) : (
        <Table size="small">
          <TableBody>
            {asksTopDown(book).map((level, index) => (
              <DepthRow key={`ask-${index}`} level={level} max={max} side="ask" />
            ))}
            {book.bids.map((level, index) => (
              <DepthRow key={`bid-${index}`} level={level} max={max} side="bid" />
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

function DepthRow({
  level,
  max,
  side,
}: {
  level: OrderBookLevel;
  max: number;
  side: "bid" | "ask";
}) {
  const ratio = depthRatio(level.size, max);
  const color = side === "bid" ? "success.main" : "error.main";

  return (
    <TableRow>
      <TableCell
        sx={{
          position: "relative",
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            insetBlock: 0,
            insetInlineStart: 0,
            width: `${ratio * 100}%`,
            bgcolor: color,
            opacity: 0.12,
          }}
        />
        {formatMoney(level.price)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {level.size}
      </TableCell>
    </TableRow>
  );
}
