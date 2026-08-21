"use client";

import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import { useWebSocket } from "@/app/hooks/useWebSocket";
import { useMarketData } from "@/app/hooks/useMarketData";
import Watchlist, { fetchWatchlist } from "@/app/components/watchlist/Watchlist";
import PriceChart from "@/app/components/chart/PriceChart";
import OrderBook from "@/app/components/orderbook/OrderBook";
import HoldingsPanel from "@/app/components/holdings/HoldingsPanel";
import ConnectionBanner from "@/app/components/connection/ConnectionBanner";

// PLAN step 35: assembles the fixed 4-widget layout (SPEC §8) around a
// single useMarketData call shared by every widget below — the one WS
// connection and the one per-symbol data stream is what makes selecting a
// symbol in the watchlist instantly update the chart, order book, and
// holdings context together (SPEC §8's core interactivity story). The
// watchlist query here shares its ["watchlist"] cache entry with
// Watchlist.tsx's own identical query — one network fetch, not two.
export default function DashboardPage() {
  const { data: watchlist = [] } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
  });

  const { client } = useWebSocket(watchlist.map((item) => item.symbol));
  const marketData = useMarketData(client);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, p: 2 }}>
      <ConnectionBanner />
      <Box
        sx={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "280px 1fr 320px" },
          gridTemplateRows: { xs: "auto", md: "1fr 1fr" },
          gridTemplateAreas: {
            xs: `"watchlist" "chart" "orderbook" "holdings"`,
            md: `"watchlist chart holdings" "watchlist orderbook holdings"`,
          },
          gap: 2,
          minHeight: 0,
        }}
      >
        {/* minWidth/minHeight: 0 override the grid item default of `auto`,
            which otherwise lets a wide table (e.g. HoldingsPanel's) overflow
            the track instead of scrolling within it. */}
        <Box sx={{ gridArea: "watchlist", overflow: "auto", minWidth: 0, minHeight: 0 }}>
          <Watchlist />
        </Box>
        <Box sx={{ gridArea: "chart", overflow: "auto", minWidth: 0, minHeight: 0 }}>
          <PriceChart marketData={marketData} />
        </Box>
        <Box sx={{ gridArea: "orderbook", overflow: "auto", minWidth: 0, minHeight: 0 }}>
          <OrderBook marketData={marketData} />
        </Box>
        <Box sx={{ gridArea: "holdings", overflow: "auto", minWidth: 0, minHeight: 0 }}>
          <HoldingsPanel marketData={marketData} />
        </Box>
      </Box>
    </Box>
  );
}
