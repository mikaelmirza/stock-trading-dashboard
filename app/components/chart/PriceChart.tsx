"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import ButtonGroup from "@mui/material/ButtonGroup";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useDashboardStore, type Timeframe } from "@/app/store/dashboard-store";
import type { MarketData } from "@/app/hooks/useMarketData";
import {
  chartOverlayMessage,
  mergeLiveTick,
  seedRowsToCandles,
  timeframeBarCount,
  type Candle,
  type SeedHistoryRow,
} from "./candle-utils";

async function fetchSeedHistory(symbol: string): Promise<SeedHistoryRow[]> {
  const res = await fetch(`/api/seed-history/${symbol}`);
  if (!res.ok) throw new Error(`seed-history fetch failed: ${res.status}`);
  return res.json();
}

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y"];

// PLAN step 30: candlestick chart for the selected symbol. Historical bars
// come from app/api/seed-history (29); live ticks come pre-filtered to
// selectedSymbol via useMarketData (26a) — this component only merges them
// into the current day's candle, it doesn't own the WS connection itself
// (that's assembled by the dashboard page in a later phase, PLAN step 35).
export default function PriceChart({ marketData }: { marketData: MarketData }) {
  const { symbol, price } = marketData;
  const selectedTimeframe = useDashboardStore((s) => s.selectedTimeframe);
  const setSelectedTimeframe = useDashboardStore((s) => s.setSelectedTimeframe);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const liveCandleRef = useRef<Candle | undefined>(undefined);

  const { data: history, isPending: isHistoryLoading } = useQuery({
    queryKey: ["seed-history", symbol],
    queryFn: () => fetchSeedHistory(symbol as string),
    enabled: symbol !== null,
  });
  const overlayMessage = chartOverlayMessage(symbol, isHistoryLoading);

  // Chart/series instances are created once and torn down on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries);
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Full replace on every symbol/history change — including clearing to
  // empty while the new symbol's history is still loading — so a symbol
  // switch never leaves the previous symbol's candles on screen (PLAN step
  // 30's "no stale bleed" requirement).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const candles = history ? seedRowsToCandles(history) : [];
    series.setData(candles);
    chartRef.current?.timeScale().fitContent();

    const last = candles[candles.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    liveCandleRef.current = last?.time === today ? last : undefined;
  }, [history, symbol]);

  // Live ticks update (or start) today's candle in place.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || price === null) return;

    const today = new Date().toISOString().slice(0, 10);
    const candle = mergeLiveTick(liveCandleRef.current, today, Number(price));
    liveCandleRef.current = candle;
    series.update(candle);
  }, [price]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const barCount = timeframeBarCount(selectedTimeframe);
    const to = chart.timeScale().getVisibleLogicalRange()?.to ?? barCount;
    chart.timeScale().setVisibleLogicalRange({ from: to - barCount, to });
  }, [selectedTimeframe]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h6" component="h2">
          {symbol ?? "Select a symbol"}
        </Typography>
        <ButtonGroup size="small">
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf}
              variant={tf === selectedTimeframe ? "contained" : "outlined"}
              onClick={() => setSelectedTimeframe(tf)}
            >
              {tf}
            </Button>
          ))}
        </ButtonGroup>
      </Box>
      <Box sx={{ position: "relative" }}>
        <Box ref={containerRef} sx={{ width: "100%", height: 400 }} />
        {overlayMessage && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              bgcolor: "background.paper",
            }}
          >
            {isHistoryLoading && symbol !== null && <CircularProgress size={24} />}
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, textAlign: "center" }}>
              {overlayMessage}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
