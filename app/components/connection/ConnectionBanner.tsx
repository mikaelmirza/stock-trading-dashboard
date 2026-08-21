"use client";

import Alert from "@mui/material/Alert";
import { useDashboardStore } from "@/app/store/dashboard-store";
import { connectionBannerContent } from "./connection-banner-utils";

// PLAN step 37: page-level banner reflecting the one connectionStatus the
// dashboard store tracks (SPEC §8) — every widget shares the same WS
// connection, so this doesn't need per-widget wiring.
export default function ConnectionBanner() {
  const connectionStatus = useDashboardStore((s) => s.connectionStatus);
  const content = connectionBannerContent(connectionStatus);
  if (!content) return null;

  return (
    <Alert severity={content.severity} sx={{ mb: 2 }}>
      {content.message}
    </Alert>
  );
}
