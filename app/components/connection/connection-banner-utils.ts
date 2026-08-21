import type { ConnectionStatus } from "@/app/store/dashboard-store";

export interface BannerContent {
  message: string;
  severity: "info" | "warning";
}

// PLAN step 37 / SPEC §5: a visible "Reconnecting…" banner rather than
// silently freezing on stale data when the relay connection drops. `null`
// means the steady state — connected — which shows nothing.
export function connectionBannerContent(status: ConnectionStatus): BannerContent | null {
  switch (status) {
    case "connected":
      return null;
    case "reconnecting":
      return { message: "Reconnecting…", severity: "warning" };
    case "connecting":
    case "disconnected":
      return { message: "Connecting to live data…", severity: "info" };
  }
}
