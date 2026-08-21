"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useDashboardStore } from "@/app/store/dashboard-store";
import { getAddableSymbols } from "./watchlist-utils";

export interface WatchlistItem {
  id: string;
  symbol: string;
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const res = await fetch("/api/watchlist");
  if (!res.ok) throw new Error(`watchlist fetch failed: ${res.status}`);
  return res.json();
}

async function addSymbol(symbol: string): Promise<void> {
  const res = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`add symbol failed: ${res.status}`);
  }
}

async function removeSymbol(symbol: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`remove symbol failed: ${res.status}`);
}

// PLAN step 28: persisted watchlist CRUD + click-to-select, wired to the
// Zustand store as the single source of truth for selectedSymbol (SPEC §8).
// Live price/daily-change is still out of scope — no PLAN step schedules
// it, and useMarketData (26a) only streams the single selectedSymbol, not
// every watchlist row simultaneously. The empty-state prompt below is PLAN
// step 36.
export default function Watchlist() {
  const queryClient = useQueryClient();
  const selectedSymbol = useDashboardStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useDashboardStore((s) => s.setSelectedSymbol);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);

  const { data: items = [], isPending } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
  });

  const addMutation = useMutation({
    mutationFn: addSymbol,
    onSuccess: () => {
      setPendingSymbol(null);
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeSymbol,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const addableSymbols = getAddableSymbols(items.map((item) => item.symbol));

  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        Watchlist
      </Typography>

      <Autocomplete
        size="small"
        options={addableSymbols}
        value={pendingSymbol}
        onChange={(_event, value) => {
          setPendingSymbol(value);
          if (value) addMutation.mutate(value);
        }}
        disabled={addMutation.isPending}
        renderInput={(params) => <TextField {...params} label="Add symbol" />}
        sx={{ mb: 2 }}
      />

      {isPending ? (
        <Typography variant="body2" color="text.secondary">
          Loading watchlist…
        </Typography>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Add your first symbol above to start tracking it.
        </Typography>
      ) : (
        <Table size="small">
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                hover
                selected={item.symbol === selectedSymbol}
                onClick={() => setSelectedSymbol(item.symbol)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell>{item.symbol}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="inherit"
                    disabled={removeMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeMutation.mutate(item.symbol);
                    }}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
