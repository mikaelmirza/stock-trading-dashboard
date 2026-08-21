"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { MarketData } from "@/app/hooks/useMarketData";
import { canSubmitTrade, tradeRejectionMessage } from "./holdings-utils";

interface TradeRequestBody {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
}

async function placeTrade(body: TradeRequestBody): Promise<unknown> {
  const res = await fetch("/api/trades", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "unknown_error");
  }
  return data;
}

// PLAN step 34: disables while the selected symbol is halted (via
// marketData.isHalted from useMarketData/26a) — client-side checks are UX
// only, app/api/trades/route.ts is the real gate (SPEC §9).
export default function TradeForm({ marketData }: { marketData: MarketData }) {
  const { symbol, price, isHalted } = marketData;
  const [quantity, setQuantity] = useState("1");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: placeTrade,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["holdings"] });
      void queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
  });

  if (!symbol) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a symbol to trade.
      </Typography>
    );
  }

  const canSubmit = canSubmitTrade({ quantity, isHalted, hasPrice: price !== null });

  function submit(side: "BUY" | "SELL") {
    if (!symbol || !canSubmit) return;
    mutation.mutate({ symbol, side, quantity: Number(quantity) });
  }

  return (
    <Box>
      {isHalted && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Trading halted for {symbol}.
        </Alert>
      )}
      {mutation.isError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {tradeRejectionMessage(mutation.error instanceof Error ? mutation.error.message : "")}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <TextField
          size="small"
          label="Quantity"
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          sx={{ width: 100 }}
        />
        <ButtonGroup>
          <Button
            color="success"
            variant="contained"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => submit("BUY")}
          >
            Buy
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => submit("SELL")}
          >
            Sell
          </Button>
        </ButtonGroup>
      </Box>
    </Box>
  );
}
